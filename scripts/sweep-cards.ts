/**
 * Hard sweep over a deck's example cards (sentence + grammar).
 *
 *   TUTOR_DATA_DIR=~/.local/share/tutor bun scripts/sweep-cards.ts <deck-id-or-name|all> [--dry] [--concurrency N]
 *
 * Generated decks drift: the model is asked for strict n+1 and often satisfies
 * the shape with a sentence nobody would say ("我的你。", "Daddy is one year old?
 * No.") or leaks its reasoning into a gloss ("My you. (grammatically valid…)").
 * This audits every example card in a deck and, for each one:
 *
 *   - strips the meta-commentary the deterministic pass can catch, and
 *   - asks the generator to rewrite it into a natural, grammatical, n+1 card, or
 *     to drop it when no natural sentence is possible with the words the learner
 *     has met.
 *
 * Vocabulary cards and their ids are never touched, so SRS scheduling, review
 * history and lesson progress survive. Only example cards can change or be
 * removed. Run with `--dry` to see the report without writing anything.
 */
import { env, roleReasoning } from '../apps/server/src/env'
import { openDb } from '../apps/server/src/db/client'
import { getRoles, getUserSetting, listCards } from '../apps/server/src/db/repo'
import { decryptSecret } from '../apps/server/src/auth'
import { OpenRouter } from '../apps/server/src/llm/openrouter'
import { langName } from '../apps/server/src/llm/prompts'
import { leapsAhead } from '../apps/server/src/deck/generate'
import { readingRules, stripMetaCommentary } from '../apps/server/src/deck/plan'
import type { CharacterVariant } from '../apps/server/src/frequency/source'
import type { Card } from '@tutor/core'

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const concFlag = args.indexOf('--concurrency')
const concurrency = concFlag >= 0 ? Math.max(1, Number(args[concFlag + 1]) || 4) : 4
const limitFlag = args.indexOf('--limit')
const limit = limitFlag >= 0 ? Math.max(1, Number(args[limitFlag + 1]) || 0) : 0
const modelFlag = args.indexOf('--model')
const modelOverride = modelFlag >= 0 ? args[modelFlag + 1] : undefined
const target = args.find(
  (a, i) =>
    !a.startsWith('--') &&
    args[i - 1] !== '--concurrency' &&
    args[i - 1] !== '--limit' &&
    args[i - 1] !== '--model',
)

const { db, sqlite } = openDb(`${env.dataDir.replace(/\/+$/, '')}/tutor.db`)

interface DeckRow {
  id: string
  userId: string
  name: string
  sourceLang: string
  targetLang: string
  instruction: string
  variant?: CharacterVariant
  readingScript?: string
}

// listDecks needs a user id, so read the decks straight from the table instead.
const deckRows = sqlite
  .query(
    'select id, user_id as userId, name, source_lang as sourceLang, target_lang as targetLang, settings_json as settingsJson from decks',
  )
  .all() as {
  id: string
  userId: string
  name: string
  sourceLang: string
  targetLang: string
  settingsJson: string
}[]
const decks: DeckRow[] = deckRows.map((row) => {
  const settings = JSON.parse(row.settingsJson || '{}') as {
    instruction?: string
    variant?: CharacterVariant
    readingScript?: string
  }
  return {
    ...row,
    instruction: settings.instruction ?? 'Continue the deck',
    variant: settings.variant,
    readingScript: settings.readingScript,
  }
})

const chosen =
  !target || target === 'all'
    ? decks
    : decks.filter((d) => d.id === target || d.name.toLowerCase().includes(target.toLowerCase()))
if (chosen.length === 0) {
  console.error(`no deck matching ${JSON.stringify(target ?? 'all')} in ${env.dataDir}`)
  process.exit(1)
}

const SWEEP_SCHEMA = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          drop: { type: 'boolean' },
          front: { type: 'string' },
          back: { type: 'string' },
          reading: { type: 'string' },
          payload: { type: 'object', additionalProperties: true },
          reason: { type: 'string' },
        },
        required: ['index'],
        additionalProperties: false,
      },
    },
  },
  required: ['cards'],
  additionalProperties: false,
}

interface AuditCard {
  index: number
  drop?: boolean
  front?: string
  back?: string
  reading?: string
  payload?: Record<string, unknown>
  reason?: string
}

function systemFor(lang: string, source: string, rules: string): string {
  return `You audit example cards in a beginner ${lang} deck. You return only the requested JSON.

A card is good only when it is something a native speaker would actually say, uses only words the learner has already met (n+1), and carries no meta-commentary. Fix each card, or drop it.

Drop a card ONLY when (a) it is ungrammatical or semantically odd, or (b) it names a word outside the card's "known" list. Never drop a card merely because it does not use a particular word, or because a nicer sentence exists.

Script rules — follow these exactly:
${rules}
- Write the blank in a cloze prompt as three underscores with no surrounding spaces ("我___書。", not "我 ___ 书").

Rules:
- Sentence cards: "back" is the ${lang} sentence; "front" and payload.gloss are its plain translation in ${source}. The sentence may use ONLY the words in that card's "known" list plus the card's own new word. Keep it short and concrete. If no natural, grammatical sentence can be made, set drop=true. Never output a semantically odd sentence such as "My you." or "Daddy is one year old? No.".
- Grammar cards: return a payload object for EVERY grammar card, with prompt = a ${lang} sentence with the practised word replaced by "___" (no spaces around it), answer = the missing ${lang} word or form, and rule = a short ${source} label. Example: prompt "你好___？", answer "嗎". Only when a cloze truly cannot work for the grammar point (e.g. a pure verb-form drill) may prompt be a short, clean ${source} sentence instead. Never return only a label: a fix must include the payload. Never drop a grammar card only because it is not a cloze; drop it only when the grammar point itself cannot be practised with the known words.
- Keep payload.options (2-3 candidate ${lang} forms including the answer) when the card already has options. payload.explanation is one short ${source} sentence shown after answering. "back" is the ${lang} answer; "front" is a short ${source} label (it is only a fallback for the prompt).
- Never put notes, parentheticals, reasoning or alternatives in any field. front/gloss are plain translations and nothing else.
- Keep each card anchored on the same new word it already practises. Do not change which word a card teaches.
- For a card that is already good, return its index alone (no drop, no fields). For one you fix, return the corrected fields. For one that cannot be saved, return drop=true with a one-line reason.`
}

/** The words the learner has met at a card's step (its lesson and everything before). */
function knownAtStep(vocabByStep: Map<number, string>, step: number): string[] {
  const words: string[] = []
  for (const [s, w] of vocabByStep) if (s <= step) words.push(w)
  return words
}

async function processDeck(or: OpenRouter, model: string, deck: DeckRow): Promise<void> {
  const cards = listCards(db, deck.userId, deck.id)
  const vocab = cards.filter((c) => c.payload?.template === 'vocab' || c.type === 'vocab')
  const vocabByStep = new Map<number, string>()
  for (const c of vocab) {
    const s = c.payload?.step
    if (typeof s === 'number') vocabByStep.set(s, c.back)
  }
  // Longest-first, for greedy tokenisation of a target sentence.
  const vocabSorted = [...vocabByStep.values()].sort((a, b) => b.length - a.length)

  const examples = cards
    .filter((c) => c.type === 'phrase' || c.type === 'grammar')
    .sort((a, b) => stepOf(a) - stepOf(b))
  if (examples.length === 0) {
    console.log(`· ${deck.name}: no example cards`)
    return
  }
  const selected = limit ? examples.slice(0, limit) : examples
  console.log(`\n=== ${deck.name} (${deck.targetLang}) — ${selected.length} examples ===`)

  const BATCH = 8
  let fixed = 0
  let dropped = 0
  let kept = 0
  const batches: Card[][] = []
  for (let i = 0; i < selected.length; i += BATCH) batches.push(selected.slice(i, i + BATCH))

  async function runBatch(batch: Card[]): Promise<void> {
    const minStep = Math.min(...batch.map(stepOf))
    // Each card carries the exact words the learner had met at its own step, so
    // a low-step card is never rewritten with a word it has not reached yet.
    const items = batch.map((c, index) => ({
      index,
      step: stepOf(c),
      type: c.type,
      front: c.front,
      back: c.back,
      reading: Object.values(c.readings)[0] ?? '',
      payload: c.payload ?? {},
      known: knownAtStep(vocabByStep, stepOf(c)).slice(-120),
    }))
    const user = `Instruction that built this deck: ${deck.instruction}
Target language: ${langName(deck.targetLang)}. Learner's language: ${langName(deck.sourceLang)}.

Cards to audit (JSON). Each card lists "known": the words the learner has met at that card's step. A rewrite may use nothing outside that list.
${JSON.stringify(items)}

Return JSON: { cards: [ { index, drop?, front?, back?, reading?, payload?, reason? } ] } — include every index.`
    let out: { cards?: AuditCard[] } | undefined
    try {
      const res = await or.chatJSON<{ cards?: AuditCard[] }>({
        model,
        schema: SWEEP_SCHEMA,
        schemaName: 'sweep',
        reasoning: roleReasoning.generator,
        messages: [
          {
            role: 'system',
            content: systemFor(
              langName(deck.targetLang),
              langName(deck.sourceLang),
              readingRules(deck.targetLang, deck.variant),
            ),
          },
          { role: 'user', content: user },
        ],
      })
      out = res.json
    } catch (err) {
      console.warn(`  batch at step ${minStep} failed: ${(err as Error).message}`)
      return
    }
    const byIndex = new Map<number, AuditCard>()
    for (const a of out?.cards ?? []) byIndex.set(a.index, a)

    for (let i = 0; i < batch.length; i++) {
      const card = batch[i]!
      const verdict = byIndex.get(i)
      if (!verdict) {
        kept++
        continue
      }
      if (verdict.drop) {
        dropped++
        console.log(`  drop: ${describe(card)}  — ${short(verdict.reason)}`)
        if (!dry) removeCard(card.id)
        continue
      }
      const next = applyVerdict(card, verdict)
      if (!next) {
        kept++
        continue
      }
      // A grammar fix must still be a usable card: an answer to grade, and a
      // prompt. A cloze prompt, when used, must be in the target language.
      if (card.type === 'grammar') {
        const answer = next.payload.answer ?? next.back
        const p = next.payload.prompt ?? next.front
        if (!answer || typeof p !== 'string' || !p) {
          kept++
          console.log(`  keep: ${describe(card)}  — rewrite had no answer/prompt`)
          continue
        }
        if (typeof p === 'string' && p.includes('___') && !looksTarget(p, card.targetLang)) {
          kept++
          console.log(`  keep: ${describe(card)}  — cloze prompt is not in the target language`)
          continue
        }
      }
      // A sentence fix must keep its tokens and back in agreement.
      if (card.type === 'phrase') {
        const tokens = next.payload.tokens
        if (Array.isArray(tokens) && tokens.length >= 2 && !tokensMatchBack(tokens, next.back)) {
          kept++
          console.log(`  keep: ${describe(card)}  — rewrite tokens no longer match its back`)
          continue
        }
      }
      // The rewrite must still be n+1 for this card's own step: never reach a
      // word introduced later. A rewrite that does is discarded, not applied.
      const future = new Set(
        [...vocabByStep.entries()].filter(([s]) => s > stepOf(card)).map(([, w]) => w),
      )
      const planned = {
        template: (card.type === 'grammar' ? 'grammar' : 'sentence') as 'grammar' | 'sentence',
        front: next.front,
        back: next.back,
        payload: next.payload,
      }
      // Also tokenise a grammar cloze prompt: it must not name a future word.
      const promptText = typeof next.payload.prompt === 'string' ? next.payload.prompt : ''
      const promptTokens = promptText
        ? tokenize(promptText.replace(/___/g, ''), vocabSorted)
        : []
      const reachesAhead =
        leapsAhead(planned, future) || promptTokens.some((t) => future.has(t))
      if (reachesAhead) {
        // The model wanted to change the card, so the original did not pass; a
        // rewrite that reaches a word the learner has not met cannot ship either.
        dropped++
        console.log(`  drop: ${describe(card)}  — only fixable with a word not yet met (n+1)`)
        if (!dry) removeCard(card.id)
        continue
      }
      fixed++
      const prompt = typeof next.payload.prompt === 'string' ? `  |  ${next.payload.prompt}` : ''
      console.log(`  fix:  ${describe(card)}\n     →  ${next.back}  |  ${next.front}${prompt}`)
      if (!dry) {
        sqlite.run(
          'update cards set front = ?, back = ?, readings_json = ?, payload_json = ? where id = ?',
          [
            next.front,
            next.back,
            JSON.stringify(next.readings),
            JSON.stringify(next.payload),
            card.id,
          ],
        )
      }
    }
  }

  const queue = [...batches]
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const batch = queue.shift()
      if (!batch) return
      await runBatch(batch)
    }
  })
  await Promise.all(workers)
  console.log(`  → ${fixed} fixed, ${dropped} dropped, ${kept} kept${dry ? ' (dry run)' : ''}`)
}

function stepOf(c: Card): number {
  const s = c.payload?.step
  return typeof s === 'number' ? s : 1_000_000
}

function describe(c: Card): string {
  return `${c.type} ${JSON.stringify(c.back)} / ${JSON.stringify(c.front)}`
}

/** One short line, so a model's rambling reason does not flood the report. */
function short(text: string | undefined): string {
  const t = (text ?? 'invalid').replace(/\s+/g, ' ').trim()
  return t.length > 140 ? `${t.slice(0, 137)}…` : t
}

function removeCard(id: string): void {
  sqlite.run('delete from srs where card_id = ?', [id])
  sqlite.run('delete from srs_reviews where card_id = ?', [id])
  sqlite.run('delete from reviews where card_id = ?', [id])
  sqlite.run('delete from attempts where card_id = ?', [id])
  sqlite.run('delete from cards where id = ?', [id])
}

interface Rewrite {
  front: string
  back: string
  readings: Record<string, string>
  payload: Record<string, unknown>
}

/** Han / kana / half-width katakana — the scripts a zh/ja target uses. */
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/
const looksTarget = (text: string, lang: string): boolean =>
  (lang === 'zh' || lang === 'yue' || lang === 'ja') && CJK.test(text)

/** A sentence's tokens must rebuild its back, ignoring spaces and punctuation. */
function tokensMatchBack(tokens: unknown[], back: string): boolean {
  const bare = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
  const joined = tokens.filter((t): t is string => typeof t === 'string').join('')
  return bare(joined) === bare(back)
}

/**
 * Greedy longest-match tokeniser over the deck's vocabulary, so a target sentence
 * can be checked word by word without a real segmenter. Words not in the list
 * fall back to single characters.
 */
function tokenize(text: string, sortedWords: string[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const match = sortedWords.find((w) => w.length > 1 && text.startsWith(w, i))
    if (match) {
      out.push(match)
      i += match.length
    } else {
      out.push(ch)
      i++
    }
  }
  return out
}

/** Merges a verdict into the card, or returns undefined when nothing changed. */
function applyVerdict(card: Card, verdict: AuditCard): Rewrite | undefined {
  let front = stripMetaCommentary(verdict.front ?? card.front)
  let back = stripMetaCommentary(verdict.back ?? card.back)
  if (!front || !back) return undefined
  // The model sometimes swaps the sides; put the target language back in `back`.
  if (looksTarget(front, card.targetLang) && !looksTarget(back, card.targetLang)) {
    ;[front, back] = [back, front]
  }
  const changed =
    front !== card.front ||
    back !== card.back ||
    verdict.payload !== undefined ||
    verdict.reading !== undefined
  if (!changed) return undefined
  const readings = { ...card.readings }
  if (verdict.reading !== undefined) {
    const key = card.targetLang === 'ja' ? 'kana' : card.targetLang === 'zh' ? 'zhuyin' : 'reading'
    if (verdict.reading) readings[key] = verdict.reading
    else delete readings[key]
  }
  const payload = { ...(card.payload ?? {}), ...(verdict.payload ?? {}) }
  if (typeof payload.prompt === 'string') {
    payload.prompt = payload.prompt.replace(/\s*___\s*/g, '___')
  }
  return { front, back, readings, payload }
}

// Pick the generator key: the deck owner's own key, else the server key.
async function keyFor(userId: string): Promise<string | undefined> {
  const own = await decryptSecret(getUserSetting(db, userId, 'openrouter_key') || undefined, env.secret)
  return own ?? env.openrouterKey
}

async function main(): Promise<void> {
  const first = chosen[0]!
  const key = await keyFor(first.userId)
  if (!key) {
    console.error('no OpenRouter key (user or server) — set OPENROUTER_API_KEY')
    process.exit(1)
  }
  const model = modelOverride ?? getRoles(db, first.userId, { ...env.defaultRoles }).judge
  console.log(`sweeping ${chosen.length} deck(s) with ${model}${dry ? ' (dry run)' : ''}`)
  const or = new OpenRouter(key, undefined)
  for (const deck of chosen) await processDeck(or, model, deck)
  sqlite.close()
}

void main()

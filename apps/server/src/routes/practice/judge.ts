/**
 * The optional LLM judge injected into grading (docs/DESIGN.md §11.2).
 *
 * Grading exercises that need prose judgement call `ctx.judge`. It is absent
 * when the server has no OpenRouter key to use, and the exercise then grades
 * with its deterministic rules alone.
 */

import type { Context } from 'hono'
import type { AppEnv } from '../../context'
import { getRoles } from '../../db/repo'
import { roleReasoning } from '../../env'
import { OpenRouter } from '../../llm/openrouter'
import { MANDARIN_RULE, NATIVE_FEEDBACK_REMINDER, NATIVE_FEEDBACK_RULE } from '../../llm/prompts'
import { resolveUserKey } from '../../llm/userkey'

/** Builds the optional LLM judge for this user (absent when no key is set). */
export async function judgeFor(c: Context<AppEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const key = await resolveUserKey(deps, user.id)
  if (!key) return undefined
  return makeJudge({
    or: new OpenRouter(key, deps.or.baseUrl),
    model: getRoles(deps.db, user.id, deps.defaults).judge,
    system: judgeSystem(user.nativeLang, user.targetLang),
    reminder: NATIVE_FEEDBACK_REMINDER(user.nativeLang, user.targetLang),
  })
}

function judgeSystem(nativeLang: string, targetLang: string | null): string {
  return [
    'You are a strict but encouraging language tutor. Reply with only the requested JSON.',
    NATIVE_FEEDBACK_RULE(nativeLang, targetLang),
    MANDARIN_RULE,
  ].join('\n')
}

interface JudgeOpts {
  or: OpenRouter
  model: string
  system: string
  reminder: string
}

/** A grade must not hang on the model: past this the deterministic result stands. */
const JUDGE_TIMEOUT_MS = 20_000

/**
 * The judge is a second opinion. When it is unreachable (rate limit, expired
 * key, timeout) the exercise falls back to its deterministic grade — every
 * caller treats `undefined` as "no verdict" — instead of failing the review.
 */
function judgeUnavailable(err: unknown): undefined {
  console.warn('[judge] unavailable, using the deterministic grade:', (err as Error).message)
  return undefined
}

/** The judge function, closed over the client, model and language rules. */
function makeJudge(opts: JudgeOpts) {
  // The language rule is repeated next to the request: small models follow the
  // last instruction far more reliably than one buried in the system prompt.
  return async (prompt: string, schema: object): Promise<unknown> => {
    const messages = [
      { role: 'system' as const, content: opts.system },
      { role: 'user' as const, content: `${prompt}\n\n${opts.reminder}` },
    ]
    return opts.or
      .chatJSON({
        model: opts.model,
        schema,
        schemaName: 'grade',
        reasoning: roleReasoning.judge,
        signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
        messages,
      })
      .then((r) => r.json, judgeUnavailable)
  }
}

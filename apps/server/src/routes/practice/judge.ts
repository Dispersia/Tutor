import type { Context } from 'hono'
import type { AppEnv } from '../../context'
import type { ServerCard } from '../../db/repo'
import { getRoles } from '../../db/repo'
import { roleReasoning } from '../../env'
import { OpenRouter } from '../../llm/openrouter'
import { JUDGE_REMINDER, judgeSystem } from '../../llm/prompts'
import { resolveUserKey } from '../../llm/userkey'
import { scriptPrefsFor } from './exerciseCtx'

export async function judgeFor(c: Context<AppEnv>, card?: ServerCard) {
  const deps = c.get('deps')
  const user = c.get('user')!
  const key = await resolveUserKey(deps, user.id)
  if (!key) return undefined
  const prefs = card ? scriptPrefsFor(deps, card) : {}
  return makeJudge({
    or: new OpenRouter(key, deps.or.baseUrl),
    model: getRoles(deps.db, user.id, deps.defaults).judge,
    system: judgeSystem(user, prefs),
    reminder: JUDGE_REMINDER(user.nativeLang, user.targetLang, prefs),
  })
}

interface JudgeOpts {
  or: OpenRouter
  model: string
  system: string
  reminder: string
}

const JUDGE_TEMPERATURE = 0.2

const JUDGE_TIMEOUT_MS = 20_000

function judgeUnavailable(err: unknown): undefined {
  console.warn('[judge] unavailable, using the deterministic grade:', (err as Error).message)
  return undefined
}

function makeJudge(opts: JudgeOpts) {
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
        temperature: JUDGE_TEMPERATURE,
        signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
        messages,
      })
      .then((r) => r.json, judgeUnavailable)
  }
}

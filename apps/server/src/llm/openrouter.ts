/**
 * OpenRouter client (docs/DESIGN.md §10): streaming chat, structured JSON, usage
 * accounting, and the live model catalogue used by the per-role model picker.
 */

const DEFAULT_BASE = 'https://openrouter.ai/api/v1'

export interface Usage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

export interface ModelInfo {
  id: string
  name: string
  contextLength: number
  promptPricePerM: number
  completionPricePerM: number
  inputModalities: string[]
  outputModalities: string[]
}

export type ChatEvent =
  { type: 'delta'; text: string } | { type: 'usage'; usage: Usage } | { type: 'done' }

export interface ChatOptions {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  title?: string
}

function mapUsage(u: Record<string, unknown> | undefined): Usage {
  const n = (v: unknown) => (typeof v === 'number' ? v : 0)
  return {
    promptTokens: n(u?.prompt_tokens),
    completionTokens: n(u?.completion_tokens),
    totalTokens: n(u?.total_tokens),
    costUsd: n(u?.cost),
  }
}

/** Splits a byte stream into lines (SSE). */
async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, idx).replace(/\r$/, '')
      buf = buf.slice(idx + 1)
    }
  }
  if (buf) yield buf
}

/** Parses one SSE `data:` payload into a ChatEvent, or null to skip. */
export function parseSseData(data: string): ChatEvent | null {
  if (data === '[DONE]') return { type: 'done' }
  let json: {
    choices?: { delta?: { content?: string } }[]
    usage?: Record<string, unknown>
  }
  try {
    json = JSON.parse(data)
  } catch {
    return null
  }
  const delta = json.choices?.[0]?.delta?.content
  if (delta) return { type: 'delta', text: delta }
  if (json.usage) return { type: 'usage', usage: mapUsage(json.usage) }
  return null
}

export class OpenRouter {
  #key?: string
  #models?: ModelInfo[]
  #modelsPath?: string

  constructor(
    key?: string,
    readonly baseUrl: string = process.env.OPENROUTER_BASE_URL ?? DEFAULT_BASE,
  ) {
    this.#key = key
  }

  get configured(): boolean {
    return Boolean(this.#key)
  }

  #headers(): Record<string, string> {
    const h: Record<string, string> = {
      'content-type': 'application/json',
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'tutor',
    }
    if (this.#key) h.authorization = `Bearer ${this.#key}`
    return h
  }

  /**
   * Live OpenRouter catalogue. `{ user: true }` uses `/models/user`, which the
   * key filters by provider preferences, privacy settings and guardrails — so a
   * user picks from exactly the models their own key can call (§10.1). Without
   * it we hit the public `/models`. Cached per client instance.
   */
  async listModels(opts: { user?: boolean } = {}): Promise<ModelInfo[]> {
    const path = opts.user ? '/models/user' : '/models'
    if (opts.user && !this.#key) throw new Error('OPENROUTER_API_KEY is not set')
    if (this.#models && this.#modelsPath === path) return this.#models
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.#headers() })
    if (!res.ok) throw new Error(`openrouter models${opts.user ? '/user' : ''} -> ${res.status}`)
    const json = (await res.json()) as { data?: Record<string, never>[] }
    this.#modelsPath = path
    this.#models = (json.data ?? []).map((m) => {
      const raw = m as unknown as {
        id: string
        name: string
        context_length?: number
        pricing?: { prompt?: string; completion?: string }
        architecture?: { input_modalities?: string[]; output_modalities?: string[] }
      }
      return {
        id: raw.id,
        name: raw.name,
        contextLength: raw.context_length ?? 0,
        promptPricePerM: Number(raw.pricing?.prompt ?? 0) * 1e6,
        completionPricePerM: Number(raw.pricing?.completion ?? 0) * 1e6,
        inputModalities: raw.architecture?.input_modalities ?? ['text'],
        outputModalities: raw.architecture?.output_modalities ?? ['text'],
      }
    })
    return this.#models
  }

  async *streamChat(opts: ChatOptions): AsyncGenerator<ChatEvent> {
    if (!this.#key) throw new Error('OPENROUTER_API_KEY is not set')
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.#headers(),
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: true,
        usage: { include: true },
        ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
      }),
    })
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '')
      throw new Error(`openrouter chat -> ${res.status}: ${detail.slice(0, 400)}`)
    }
    for await (const line of lines(res.body)) {
      if (!line.startsWith('data:')) continue
      const ev = parseSseData(line.slice(5).trim())
      if (!ev) continue
      yield ev
      if (ev.type === 'done') return
    }
    yield { type: 'done' }
  }

  async chat(opts: ChatOptions): Promise<{ text: string; usage: Usage }> {
    let text = ''
    let usage: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }
    for await (const ev of this.streamChat(opts)) {
      if (ev.type === 'delta') text += ev.text
      else if (ev.type === 'usage') usage = ev.usage
    }
    return { text, usage }
  }

  /** Structured output validated against a JSON schema (used by graders). */
  async chatJSON<T>(opts: ChatOptions & { schema: object; schemaName?: string }): Promise<{
    json: T
    usage: Usage
  }> {
    if (!this.#key) throw new Error('OPENROUTER_API_KEY is not set')
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.#headers(),
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        usage: { include: true },
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: opts.schemaName ?? 'result',
            strict: true,
            schema: opts.schema,
          },
        },
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`openrouter json -> ${res.status}: ${detail.slice(0, 400)}`)
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: Record<string, unknown>
    }
    const content = json.choices?.[0]?.message?.content ?? '{}'
    return { json: JSON.parse(content) as T, usage: mapUsage(json.usage) }
  }
}

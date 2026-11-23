/**
 * OpenRouter client (docs/DESIGN.md §10): streaming chat, structured JSON, usage
 * accounting, and the live model catalogue used by the per-role model picker.
 */

const DEFAULT_BASE = 'https://openrouter.ai/api/v1'

/**
 * A JSON completion with no caller-supplied signal is cut off after this long:
 * a hung provider would otherwise hold a deck build (or a grade) open forever.
 */
export const JSON_TIMEOUT_MS = 120_000

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

/**
 * How much hidden reasoning a model may spend before answering. Thinking models
 * (Qwen 3.8, …) default to a model-chosen budget, which can be hundreds of
 * tokens the learner never sees; pick `none` for latency-sensitive roles.
 */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh'

export interface ChatOptions {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  title?: string
  /** Defaults to `none` — see `ReasoningEffort`. */
  reasoning?: ReasoningEffort
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
  try {
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
  } finally {
    // Runs when the consumer stops early or throws too: release the connection.
    await reader.cancel().catch(() => {})
  }
}

interface StreamChunk {
  choices?: { delta?: { content?: string } }[]
  usage?: Record<string, unknown>
  error?: { message?: string; code?: unknown } | string
}

/** The message of a mid-stream `{"error": …}` chunk, or undefined. */
function streamError(json: StreamChunk): string | undefined {
  if (!json.error) return undefined
  if (typeof json.error === 'string') return json.error
  return json.error.message ?? `code ${String(json.error.code ?? 'unknown')}`
}

/**
 * Parses one SSE `data:` payload into a ChatEvent, or null to skip. A provider
 * failure after the stream opened arrives as an `error` chunk under HTTP 200: it
 * is thrown, so the half reply is never taken for a finished message.
 */
export function parseSseData(data: string): ChatEvent | null {
  if (data === '[DONE]') return { type: 'done' }
  let json: StreamChunk | null
  try {
    json = JSON.parse(data) as StreamChunk | null
  } catch {
    return null
  }
  if (!json || typeof json !== 'object') return null
  const failure = streamError(json)
  if (failure) throw new Error(`openrouter stream error: ${failure}`)
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
    const json = (await res.json()) as { data?: RawModel[] }
    this.#modelsPath = path
    this.#models = (json.data ?? []).map(toModelInfo)
    return this.#models
  }

  async *streamChat(opts: ChatOptions): AsyncGenerator<ChatEvent> {
    if (!this.#key) throw new Error('OPENROUTER_API_KEY is not set')
    const res = await sendStream(this.baseUrl, this.#headers(), opts)
    for await (const line of lines(res.body!)) {
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
    const res = await sendJson(this.baseUrl, this.#headers(), opts)
    const json = (await res.json()) as JsonResponse
    const choice = json.choices?.[0]
    // A response cut off by the output cap is not recoverable JSON — say so
    // plainly so a caller (the deck builder) can retry with a smaller batch.
    if (choice?.finish_reason === 'length') {
      throw new Error('the model ran out of output space before its JSON was complete')
    }
    const content = choice?.message?.content
    // A 200 can still carry a provider error or a refusal with no content. Passing
    // that off as `{}` made a failed batch look like an empty, finished one.
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error(
        `the model returned no content${json.error?.message ? `: ${json.error.message}` : ''}`,
      )
    }
    return parseJson<T>(content, json.usage)
  }
}

/** The streaming request, through the shared completions endpoint. */
async function sendStream(
  baseUrl: string,
  headers: Record<string, string>,
  opts: ChatOptions,
): Promise<Response> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal: opts.signal,
    body: JSON.stringify(streamBody(opts)),
  })
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`openrouter chat -> ${res.status}: ${detail.slice(0, 400)}`)
  }
  return res
}

function streamBody(opts: ChatOptions) {
  return {
    model: opts.model,
    messages: opts.messages,
    stream: true,
    usage: { include: true },
    reasoning: { effort: opts.reasoning ?? 'none' },
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    ...(opts.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
  }
}

type JsonOptions = ChatOptions & { schema: object; schemaName?: string }

/** The JSON-schema request, through the shared completions endpoint. */
async function sendJson(
  baseUrl: string,
  headers: Record<string, string>,
  opts: JsonOptions,
): Promise<Response> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal: opts.signal ?? AbortSignal.timeout(JSON_TIMEOUT_MS),
    body: JSON.stringify(jsonBody(opts)),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`openrouter json -> ${res.status}: ${detail.slice(0, 400)}`)
  }
  return res
}

function jsonBody(opts: JsonOptions) {
  return {
    model: opts.model,
    messages: opts.messages,
    usage: { include: true },
    reasoning: { effort: opts.reasoning ?? 'none' },
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    ...(opts.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
    response_format: {
      type: 'json_schema',
      json_schema: { name: opts.schemaName ?? 'result', strict: true, schema: opts.schema },
    },
  }
}

interface JsonResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[]
  error?: { message?: string }
  usage?: Record<string, unknown>
}

function parseJson<T>(content: string, usage: Record<string, unknown> | undefined) {
  try {
    return { json: JSON.parse(content) as T, usage: mapUsage(usage) }
  } catch (err) {
    throw new Error(`the model did not return valid JSON (${(err as Error).message})`, {
      cause: err,
    })
  }
}

/** One catalogue entry as the raw OpenRouter API returns it. */
interface RawModel {
  id: string
  name: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
}

function toModelInfo(raw: RawModel): ModelInfo {
  return {
    id: raw.id,
    name: raw.name,
    contextLength: raw.context_length ?? 0,
    promptPricePerM: Number(raw.pricing?.prompt ?? 0) * 1e6,
    completionPricePerM: Number(raw.pricing?.completion ?? 0) * 1e6,
    inputModalities: raw.architecture?.input_modalities ?? ['text'],
    outputModalities: raw.architecture?.output_modalities ?? ['text'],
  }
}

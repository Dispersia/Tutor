import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { Readable, Writable } from 'node:stream'

const HELPER = process.env.TUTOR_MOZC_HELPER ?? '/Users/dispe/mozc-build/bin/mozc_emacs_helper'
const SERVER = process.env.TUTOR_MOZC_SERVER ?? '/Users/dispe/mozc-build/bin/mozc_server'
const LIMIT = 12

type Helper = ChildProcessByStdio<Writable, Readable, null>

type Sexp = string | Sexp[] | { d: [Sexp, Sexp] }

let helper: Helper | undefined
let server: ChildProcess | undefined
let serverReady: Promise<void> | undefined
let buffer = ''
let greeted = false
let warm = false
let eventId = 0
let chain: Promise<unknown> = Promise.resolve()
const waiters: Array<{ resolve: (line: string) => void; reject: (err: Error) => void }> = []

export function mozcAvailable(): boolean {
  return existsSync(HELPER) && existsSync(SERVER)
}

function onData(chunk: string): void {
  buffer += chunk
  let at: number
  while ((at = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, at)
    buffer = buffer.slice(at + 1)
    waiters.shift()?.resolve(line)
  }
}

function ensureServer(): Promise<void> {
  if (!server) {
    const proc = spawn(SERVER, [], { stdio: 'ignore' })
    proc.on('exit', () => (server = undefined))
    server = proc
    serverReady = new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return serverReady ?? Promise.resolve()
}

function ensureHelper(): Helper {
  if (helper) return helper
  const proc = spawn(HELPER, ['--suppress_stderr'], { stdio: ['pipe', 'pipe', 'ignore'] })
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', onData)
  proc.on('exit', () => {
    helper = undefined
    greeted = false
    while (waiters.length) waiters.shift()!.reject(new Error('mozc helper exited'))
  })
  helper = proc
  return proc
}

function readLine(): Promise<string> {
  return new Promise((resolve, reject) => waiters.push({ resolve, reject }))
}

async function call(command: string): Promise<string> {
  ensureHelper().stdin.write(`${command}\n`)
  return readLine()
}

async function greet(): Promise<void> {
  await ensureServer()
  ensureHelper()
  if (greeted) return
  greeted = true
  await readLine()
}

function nextId(): number {
  return ++eventId
}

function literal(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

class SexprReader {
  private at = 0

  constructor(private readonly input: string) {}

  parse(): Sexp {
    this.skip()
    if (this.input[this.at] === '(') return this.list()
    if (this.input[this.at] === '"') return this.string()
    return this.atom()
  }

  private skip(): void {
    while (this.at < this.input.length && /\s/.test(this.input[this.at]!)) this.at++
  }

  private list(): Sexp {
    this.at++
    const items: Sexp[] = []
    for (;;) {
      this.skip()
      if (this.at >= this.input.length || this.input[this.at] === ')') {
        this.at++
        break
      }
      if (this.dotted(items)) {
        const cdr = this.parse()
        this.skip()
        if (this.input[this.at] === ')') this.at++
        return { d: [items.length === 1 ? items[0]! : items, cdr] }
      }
      items.push(this.parse())
    }
    return items
  }

  private dotted(items: Sexp[]): boolean {
    if (this.input[this.at] !== '.') return false
    if (!/[\s)]/.test(this.input[this.at + 1] ?? ')')) return false
    if (items.length === 0) return false
    this.at++
    return true
  }

  private string(): string {
    this.at++
    let out = ''
    while (this.at < this.input.length) {
      const ch = this.input[this.at]!
      if (ch === '\\') {
        const next = this.input[this.at + 1]!
        out += next === 'n' ? '\n' : next === 't' ? '\t' : next
        this.at += 2
        continue
      }
      this.at++
      if (ch === '"') break
      out += ch
    }
    return out
  }

  private atom(): string {
    let out = ''
    while (this.at < this.input.length && !/[\s()]/.test(this.input[this.at]!)) {
      out += this.input[this.at++]
    }
    return out
  }
}

function parseSexp(input: string): Sexp {
  return new SexprReader(input).parse()
}

function pairs(sexp: Sexp | undefined): Map<string, Sexp> {
  const map = new Map<string, Sexp>()
  if (!Array.isArray(sexp)) return map
  if (typeof sexp[0] === 'string') {
    map.set(sexp[0], sexp.slice(1))
    return map
  }
  for (const item of sexp) {
    if (Array.isArray(item) && typeof item[0] === 'string') {
      map.set(item[0], item.slice(1))
    } else if (item && typeof item === 'object' && 'd' in item) {
      const [key, val] = item.d
      if (typeof key === 'string') map.set(key, val)
    }
  }
  return map
}

function wordsIn(sexp: Sexp | undefined): string[] {
  const out: string[] = []
  const window = pairs(pairs(sexp).get('candidate-window')).get('candidate')
  const all = pairs(pairs(sexp).get('all-candidate-words')).get('candidates')
  for (const list of [window, all]) {
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      const value = pairs(entry).get('value')
      if (typeof value === 'string') out.push(value)
    }
  }
  return out
}

export function responseWords(line: string): string[] {
  return wordsIn(pairs(parseSexp(line)).get('output'))
}

async function attempt(kana: string): Promise<string[]> {
  const created = await call(`(${nextId()} CreateSession)`)
  const session = pairs(parseSexp(created)).get('emacs-session-id') ?? '1'
  const live = await call(`(${nextId()} SendKey ${session} ${literal(kana)})`)
  const converted = await call(`(${nextId()} SendKey ${session} space)`)
  await call(`(${nextId()} DeleteSession ${session})`)
  const list = [...responseWords(live), ...responseWords(converted)]
  return [...new Set(list)].slice(0, LIMIT)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function convert(kana: string): Promise<string[]> {
  await greet()
  let list = await attempt(kana)
  for (let tries = 0; !warm && list.length === 0 && tries < 12; tries++) {
    await delay(500)
    list = await attempt(kana)
  }
  if (list.length) warm = true
  return list
}

export function mozcCandidates(kana: string): Promise<string[]> {
  const run = chain.then(
    () => convert(kana),
    () => convert(kana),
  )
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { App } from './context'

const PLACEHOLDER = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Tutor</title>
<style>
  :root { color-scheme: dark; }
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 1.2rem; max-width: 44rem; }
  h1 { font-size: 1.2rem; margin: 0 0 .2rem; }
  p.sub { color: #9aa; margin: 0 0 1rem; font-size: .85rem; }
  textarea { width: 100%; box-sizing: border-box; background:#111; color:#eee; border:1px solid #333;
             border-radius:.5rem; padding:.6rem; resize:vertical; }
  button { margin-top:.5rem; padding:.5rem .9rem; border-radius:.5rem; border:1px solid #444;
           background:#1b1b1b; color:#eee; cursor:pointer; }
  #out { white-space: pre-wrap; margin-top:1rem; min-height:3rem; }
  a { color:#6cf; }
  code { background:#1b1b1b; padding:.1rem .3rem; border-radius:.3rem; }
</style>
</head>
<body>
  <h1>Tutor — api is up</h1>
  <p class="sub">Phase 2 placeholder. The SvelteKit PWA replaces this in Phase 3.
    Try the streaming chat (needs <code>OPENROUTER_API_KEY</code>):
    <a href="/api/health">/api/health</a> · <a href="/api/models?q=qwen">/api/models?q=qwen</a>
  </p>
  <textarea id="in" rows="3" placeholder="Say something in your target language…"></textarea>
  <button onclick="send()">Send (streaming)</button>
  <div id="out"></div>
<script>
async function send() {
  const out = document.getElementById('out')
  const text = document.getElementById('in').value
  out.textContent = ''
  const res = await fetch('/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, role: 'conversation' }),
  })
  if (!res.ok) { out.textContent = 'error: ' + (await res.text()); return }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
  for (;;) {
    const { done, value } = await reader.read(); if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\\n\\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2)
      const ev = {}
      for (const line of chunk.split('\\n')) {
        const m = /^([a-zA-Z]+):\\s?(.*)$/.exec(line); if (m) ev[m[1]] = m[2]
      }
      if (ev.event === 'delta') out.textContent += ev.data
      else if (ev.event === 'error') out.textContent += '\\n[error] ' + ev.data
    }
  }
}
</script>
</body>
</html>`

function cacheHeaders(path: string): Record<string, string> {
  if (path.startsWith('/_app/immutable/')) {
    return { 'cache-control': 'public, max-age=31536000, immutable' }
  }
  if (path.startsWith('/vad/') && path !== '/vad/manifest.json') {
    return { 'cache-control': 'public, max-age=31536000, immutable' }
  }
  if (
    path === '/' ||
    path.endsWith('.html') ||
    path === '/service-worker.js' ||
    path.endsWith('.webmanifest')
  ) {
    return { 'cache-control': 'no-cache' }
  }
  return { 'cache-control': 'public, max-age=3600' }
}

export function registerStatic(app: App, staticDir: string) {
  app.get('*', (c) => {
    const path = c.req.path
    if (path.startsWith('/api/')) return c.notFound()

    const direct = join(staticDir, path === '/' ? 'index.html' : path)
    if (existsSync(direct) && statSync(direct).isFile()) {
      return new Response(Bun.file(direct), { headers: cacheHeaders(path) })
    }
    const index = join(staticDir, 'index.html')
    if (existsSync(index)) {
      return new Response(Bun.file(index), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
      })
    }
    return c.html(PLACEHOLDER)
  })
}

export function readTls(cert?: string, key?: string): { cert: string; key: string } | undefined {
  if (!cert || !key || !existsSync(cert) || !existsSync(key)) return undefined
  return { cert: readFileSync(cert, 'utf8'), key: readFileSync(key, 'utf8') }
}

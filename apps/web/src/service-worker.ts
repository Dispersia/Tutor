/// <reference types="@sveltejs/kit" />
import { version } from '$app/env'
import { assets, immutable } from '$app/manifest'
import { base } from '#lib/paths'

const CACHE = `tutor-${version}`
// Silero VAD weights + the onnxruntime wasm are ~16 MB and only matter when
// someone records, so they are cached on first use instead of on install.
const HEAVY = /^vad\//
const ASSETS: string[] = [...immutable, ...assets]
  .map((a) => a.path as string)
  .filter((p) => !HEAVY.test(p))
const scope = self as unknown as ServiceWorkerGlobalScope

scope.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => scope.skipWaiting()),
  )
})

scope.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => scope.clients.claim()),
  )
})

// App shell + assets. Never cache the API — chat/speech must always hit the Mac.
scope.addEventListener('fetch', (event: FetchEvent) => {
  if (!shouldHandle(event)) return
  // Navigations are network-first; hashed assets are cache-first.
  event.respondWith(event.request.mode === 'navigate' ? navigateFetch(event) : assetFetch(event))
})

/** A GET for the app's own origin, never one of the API routes. */
function shouldHandle(event: FetchEvent): boolean {
  if (event.request.method !== 'GET') return false
  const url = new URL(event.request.url)
  if (url.origin !== scope.location.origin) return false
  return !url.pathname.startsWith(`${base}/api/`)
}

/** Network-first, so a new deploy shows up on the next open (cache is offline fallback). */
function navigateFetch(event: FetchEvent): Promise<Response> {
  return fetch(event.request)
    .then((res) => {
      if (res.ok) cacheCopy(event.request, res)
      return res
    })
    .catch(() =>
      caches
        .match(event.request)
        .then((r) => r ?? caches.match(`${base}/index.html`))
        .then((r) => r ?? Response.error()),
    )
}

/** Cache-first: the hashed asset name changes whenever its content does. */
function assetFetch(event: FetchEvent): Promise<Response> {
  return caches.match(event.request).then(
    (cached) =>
      cached ??
      fetch(event.request).then((res) => {
        if (res.ok && res.type === 'basic') cacheCopy(event.request, res)
        return res
      }),
  )
}

function cacheCopy(request: Request, res: Response): void {
  const copy = res.clone()
  void caches.open(CACHE).then((c) => c.put(request, copy))
}

// --- rig alerts (docs/DESIGN.md §13.5.1) -------------------------------------
// The server pushes when a rig's run crosses the lead time. A focused window
// already shows the same alert from its own timer, so skip the duplicate there.

scope.addEventListener('push', (event: PushEvent) => {
  event.waitUntil(showPush(pushData(event)))
})

interface PushPayload {
  title?: string
  body?: string
  url?: string
  tag?: string
  force?: boolean
}

function pushData(event: PushEvent): PushPayload {
  try {
    return (event.data?.json() ?? {}) as PushPayload
  } catch {
    return { body: event.data?.text() ?? '' }
  }
}

async function showPush(data: PushPayload): Promise<void> {
  // A focused window shows its own timer, so skip the duplicate — except for a
  // test push, where the user is watching this very page and expects it.
  if (!data.force && (await anyFocused())) return
  await scope.registration.showNotification(data.title ?? 'Tutor', {
    body: data.body ?? '',
    tag: data.tag ?? 'tutor',
    icon: `${base}/icons/icon-192.png`,
    badge: `${base}/icons/icon-192.png`,
    data: { url: data.url ?? '/home' },
  })
}

async function anyFocused(): Promise<boolean> {
  const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true })
  return windows.some((c) => c.focused)
}

scope.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const target = `${base}${(event.notification.data as { url?: string } | undefined)?.url ?? '/home'}`
  event.waitUntil(
    (async () => {
      const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus()
          return
        }
      }
      await scope.clients.openWindow(target)
    })(),
  )
})

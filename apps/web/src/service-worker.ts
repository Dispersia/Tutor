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
  const url = new URL(event.request.url)
  if (
    event.request.method !== 'GET' ||
    url.origin !== scope.location.origin ||
    url.pathname.startsWith(`${base}/api/`)
  ) {
    return
  }

  // Navigations are network-first, so a new deploy shows up on the next open;
  // the cache is only a fallback when offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            void caches.open(CACHE).then((c) => c.put(event.request, copy))
          }
          return res
        })
        .catch(() =>
          caches
            .match(event.request)
            .then((r) => r ?? caches.match(`${base}/index.html`))
            .then((r) => r ?? Response.error()),
        ),
    )
    return
  }

  // Everything else (hashed immutable assets) is cache-first.
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ??
        fetch(event.request).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone()
            void caches.open(CACHE).then((c) => c.put(event.request, copy))
          }
          return res
        }),
    ),
  )
})

// --- rig alerts (docs/DESIGN.md §13.5.1) -------------------------------------
// The server pushes when a rig's run crosses the lead time. A focused window
// already shows the same alert from its own timer, so skip the duplicate there.

scope.addEventListener('push', (event: PushEvent) => {
  let data: { title?: string; body?: string; url?: string; tag?: string; force?: boolean } = {}
  try {
    data = (event.data?.json() ?? {}) as typeof data
  } catch {
    data = { body: event.data?.text() ?? '' }
  }
  event.waitUntil(
    (async () => {
      // A focused window shows its own timer, so skip the duplicate — except for
      // a test push, where the user is watching this very page and expects it.
      if (!data.force) {
        const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true })
        if (windows.some((c) => c.focused)) return
      }
      await scope.registration.showNotification(data.title ?? 'Tutor', {
        body: data.body ?? '',
        tag: data.tag ?? 'tutor',
        icon: `${base}/icons/icon-192.png`,
        badge: `${base}/icons/icon-192.png`,
        data: { url: data.url ?? '/home' },
      })
    })(),
  )
})

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

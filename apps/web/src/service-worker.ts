/// <reference types="@sveltejs/kit" />
import { version } from '$app/env'
import { assets, immutable } from '$app/manifest'
import { base } from '#lib/paths'

/** This deploy's cache: the app shell and the unhashed static files. */
const CACHE = `tutor-${version}`
/**
 * Hashed build output, shared by every deploy: a file's name changes whenever
 * its content does, so an entry is never stale and a deploy only downloads what
 * actually changed (instead of every script and ~9 MB of fonts again).
 */
const HASHED = 'tutor-assets'
/** The cached app shell — the SPA's one HTML document, whatever the route. */
const SHELL = `${base}/`
// Silero VAD weights + the onnxruntime wasm are ~16 MB and only matter when
// someone records; the CJK faces are megabytes each and a learner needs one or
// two of them. Both are cached on first use instead of on install.
const HEAVY = /^vad\/|(^|\/)noto-[^/]+\.woff2$/
const scope = self as unknown as ServiceWorkerGlobalScope

/** The pathname a manifest entry is served at. */
const servedAt = (path: string) => new URL(path, scope.location.href).pathname
const paths = (list: { path: string }[]) => list.map((a) => a.path).filter((p) => !HEAVY.test(p))
const STATIC = paths(assets)
const BUILD = paths(immutable)
/** Every hashed file of this build (heavy ones too), by pathname. */
const HASHED_PATHS = new Set(immutable.map((a) => servedAt(a.path)))

scope.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(precache().then(() => scope.skipWaiting()))
})

/** The shell and static files for this version; hashed files only when new. */
async function precache(): Promise<void> {
  const versioned = await caches.open(CACHE)
  await versioned.addAll([SHELL, ...STATIC])
  const hashed = await caches.open(HASHED)
  const have = new Set((await hashed.keys()).map((r) => new URL(r.url).pathname))
  await hashed.addAll(BUILD.filter((p) => !have.has(servedAt(p))))
}

scope.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    dropOldCaches()
      .then(pruneHashed)
      .then(() => scope.clients.claim()),
  )
})

async function dropOldCaches(): Promise<void> {
  const keys = await caches.keys()
  await Promise.all(keys.filter((k) => k !== CACHE && k !== HASHED).map((k) => caches.delete(k)))
}

/** Forgets hashed files this build no longer ships, so the cache cannot grow forever. */
async function pruneHashed(): Promise<void> {
  const hashed = await caches.open(HASHED)
  const stale = (await hashed.keys()).filter((r) => !HASHED_PATHS.has(new URL(r.url).pathname))
  await Promise.all(stale.map((r) => hashed.delete(r)))
}

// App shell + assets. Never cache the API — chat/speech must always hit the Mac.
scope.addEventListener('fetch', (event: FetchEvent) => {
  if (!shouldHandle(event)) return
  // Navigations are network-first; assets are cache-first.
  event.respondWith(event.request.mode === 'navigate' ? navigateFetch(event) : assetFetch(event))
})

/** A GET for the app's own origin, never one of the API routes. */
function shouldHandle(event: FetchEvent): boolean {
  if (event.request.method !== 'GET') return false
  const url = new URL(event.request.url)
  if (url.origin !== scope.location.origin) return false
  return !url.pathname.startsWith(`${base}/api/`)
}

/**
 * Network-first, so a new deploy shows up on the next open. Offline, every
 * route falls back to the precached shell: the client router takes it from there.
 */
function navigateFetch(event: FetchEvent): Promise<Response> {
  return fetch(event.request).catch(() =>
    caches.match(SHELL, { cacheName: CACHE }).then((r) => r ?? Response.error()),
  )
}

/** Cache-first; a hashed file is kept across deploys, anything else for this one. */
function assetFetch(event: FetchEvent): Promise<Response> {
  const { request } = event
  const cacheName = HASHED_PATHS.has(new URL(request.url).pathname) ? HASHED : CACHE
  return caches.match(request).then(
    (cached) =>
      cached ??
      fetch(request).then((res) => {
        // Only whole responses: a ranged 206 cannot be stored.
        if (res.status === 200 && res.type === 'basic') cacheCopy(cacheName, request, res)
        return res
      }),
  )
}

function cacheCopy(cacheName: string, request: Request, res: Response): void {
  const copy = res.clone()
  void caches
    .open(cacheName)
    .then((c) => c.put(request, copy))
    .catch(() => {}) // a full disk must not break the fetch it rode on
}

// --- rig alerts (docs/DESIGN.md §13.5.1) -------------------------------------
// The server pushes when a rig's run crosses the lead time. A push is always
// shown: the focused window's own timer uses the same tag, so the two collapse
// into one notification — and a window that looks focused but is not actually
// alerting (alerts off in that tab, a throttled timer) no longer swallows it.
// Browsers also require a visible notification for every push.

scope.addEventListener('push', (event: PushEvent) => {
  event.waitUntil(showPush(pushData(event)))
})

interface PushPayload {
  title?: string
  body?: string
  url?: string
  tag?: string
}

function pushData(event: PushEvent): PushPayload {
  try {
    return (event.data?.json() ?? {}) as PushPayload
  } catch {
    return { body: event.data?.text() ?? '' }
  }
}

async function showPush(data: PushPayload): Promise<void> {
  await scope.registration.showNotification(data.title ?? 'Tutor', {
    body: data.body ?? '',
    tag: data.tag ?? 'tutor',
    icon: `${base}/icons/icon-192.png`,
    badge: `${base}/icons/icon-192.png`,
    data: { url: data.url ?? '/home' },
  })
}

scope.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const path = (event.notification.data as { url?: string } | undefined)?.url ?? '/home'
  event.waitUntil(openTarget(`${base}${path}`))
})

/** Brings an open window to the front on the target screen, or opens one. */
async function openTarget(target: string): Promise<void> {
  const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const client = windows.find((c) => c.focused) ?? windows[0]
  if (!client) {
    await scope.clients.openWindow(target)
    return
  }
  const shown = await client.focus().catch(() => client)
  if (new URL(shown.url).pathname === target) return
  // navigate() rejects for a window this worker does not control yet.
  await shown.navigate(target).catch(() => scope.clients.openWindow(target))
}

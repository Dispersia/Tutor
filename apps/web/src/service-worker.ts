/// <reference types="@sveltejs/kit" />
import { version } from '$app/env'
import { assets, immutable } from '$app/manifest'
import { base } from '#lib/paths'

const CACHE = `tutor-${version}`
const HASHED = 'tutor-assets'
const SHELL = `${base}/`
const HEAVY = /^vad\/|(^|\/)noto-[^/]+\.woff2$/
const scope = self as unknown as ServiceWorkerGlobalScope

const servedAt = (path: string) => new URL(path, scope.location.href).pathname
const paths = (list: { path: string }[]) => list.map((a) => a.path).filter((p) => !HEAVY.test(p))
const STATIC = paths(assets)
const BUILD = paths(immutable)
const HASHED_PATHS = new Set(immutable.map((a) => servedAt(a.path)))

scope.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(precache().then(() => scope.skipWaiting()))
})

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

async function pruneHashed(): Promise<void> {
  const hashed = await caches.open(HASHED)
  const stale = (await hashed.keys()).filter((r) => !HASHED_PATHS.has(new URL(r.url).pathname))
  await Promise.all(stale.map((r) => hashed.delete(r)))
}

scope.addEventListener('fetch', (event: FetchEvent) => {
  if (!shouldHandle(event)) return
  event.respondWith(event.request.mode === 'navigate' ? navigateFetch(event) : assetFetch(event))
})

function shouldHandle(event: FetchEvent): boolean {
  if (event.request.method !== 'GET') return false
  const url = new URL(event.request.url)
  if (url.origin !== scope.location.origin) return false
  return !url.pathname.startsWith(`${base}/api/`)
}

function navigateFetch(event: FetchEvent): Promise<Response> {
  return fetch(event.request).catch(() =>
    caches.match(SHELL, { cacheName: CACHE }).then((r) => r ?? Response.error()),
  )
}

function assetFetch(event: FetchEvent): Promise<Response> {
  const { request } = event
  const cacheName = HASHED_PATHS.has(new URL(request.url).pathname) ? HASHED : CACHE
  return caches.match(request).then(
    (cached) =>
      cached ??
      fetch(request).then((res) => {
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
    .catch(() => {})
}

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

async function openTarget(target: string): Promise<void> {
  const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const client = windows.find((c) => c.focused) ?? windows[0]
  if (!client) {
    await scope.clients.openWindow(target)
    return
  }
  const shown = await client.focus().catch(() => client)
  if (new URL(shown.url).pathname === target) return
  await shown.navigate(target).catch(() => scope.clients.openWindow(target))
}

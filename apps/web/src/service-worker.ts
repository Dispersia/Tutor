/// <reference types="@sveltejs/kit" />
import { version } from '$app/env'
import { assets, immutable } from '$app/manifest'

const CACHE = `tutor-${version}`
const ASSETS: string[] = [...immutable, ...assets].map((a) => a.path as string)
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
    url.pathname.startsWith('/api/')
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
            .then((r) => r ?? caches.match('/index.html'))
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

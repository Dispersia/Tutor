# @tutor/web

SvelteKit PWA (mobile-first, Android-primary) for tutor.

- **SPA**: `adapter-static` with `index.html` fallback; the Bun server
  (`apps/server`) hosts the build and the API on the same origin.
- **Auth-aware**: every route except `/login` requires a session.
- Screens: `home` · `learn` · `practice` · `chat` · `history` · `skills` ·
  `combat` · `inventory` · `bank` · `settings`.
- Every link and fetch goes through `src/lib/paths.ts` (`href()`): production is
  served under `/tutor`. Layout and conventions: `docs/ARCHITECTURE.md`.
- **TTS/ASR** come from the local MLX gateway via `/api/speech/*`.
- PWA: `static/manifest.webmanifest` + `src/service-worker.ts` (app-shell cache).

```bash
just dev-web     # dev server on :5173, proxies /api → :4318
just build       # -> apps/web/build (served by the API)
just check       # svelte-check
```

Over HTTPS the mic works on the phone (see `docs/DESIGN.md` §14.1).

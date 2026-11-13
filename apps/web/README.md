# SvelteKit PWA

This app is scaffolded in **Phase 3** (`nix develop && bunx sv create .`) as a
mobile-first SvelteKit PWA using `adapter-static` in SPA mode.

Planned structure:

```
src/routes/           Home HUD · Practice · Conversation · History · Settings
src/lib/components/   card renderer, recorder, waveform, XP HUD
src/service-worker.ts PWA offline app shell
static/               manifest.webmanifest, icons
```

The SvelteKit dev/build steps are wired into the root `justfile` and the Nix
packaging in Phase 3 / Phase 7. See `docs/DESIGN.md` §14.

# Agent notes for this repo

## Before a task is done

Run `bun run verify` (or `just ci`): format, lint, architecture rules, dead-code
findings (knip), typecheck (server + web) and tests. Layout and conventions are in
`docs/ARCHITECTURE.md`; the design is `docs/DESIGN.md`; open defects are
in `docs/BACKLOG.md` — remove an item there when you fix it.

## No comments in code

Do not write comments in source files (`.ts`, `.js`, `.svelte`, `.css`, `.html`):
no JSDoc, no header blocks, no inline notes, no `<!-- -->` in markup. They are
kept out to save context. Make code explain itself with names and small functions;
put design reasoning in `docs/DESIGN.md` and open defects in `docs/BACKLOG.md`.
The only exceptions are tool directives the code needs to build or lint:
`eslint-disable`, `@ts-expect-error`/`@ts-ignore`, `svelte-ignore` and
`prettier-ignore`. An empty `catch {}` is allowed without an explanatory comment.

## Update the launchd server after completing a task

tutor runs on this Mac as a per-user **launchd** agent, so code in the working
checkout is not live until that agent is restarted on a fresh build. **After every
change, redeploy:**

```sh
./deploy/deploy.sh        # or `just deploy` — same script
```

That script does `just package` (nix build -> `./result/bin/tutor`, base path
`/tutor`), reinstalls and restarts `dev.tutor.serve` onto the new binary, and
waits for `/api/health`. The manual equivalent is:

```sh
just package                                           # nix build -> ./result/bin/tutor (base path /tutor)
launchctl kickstart -k "gui/$(id -u)/dev.tutor.serve"  # restart onto the new binary
curl -s http://127.0.0.1:4318/api/health               # sanity check
```

- The live agent is `dev.tutor.serve` (from `deploy/launchd.plist.template`,
  installed at `~/Library/LaunchAgents/dev.tutor.serve.plist`). It runs
  `deploy/tutor-serve.sh`, which `exec`s `./result/bin/tutor` — hence the rebuild
  **and** the restart, not just a restart.
- `just service-install` does the whole thing in one shot: package, rewrite the
  plist, then `launchctl bootout` + `bootstrap`.
- It is served over HTTPS through the tailnet gateway (`tailscale serve /tutor` →
  `127.0.0.1:4318`), so the app must be built with its base path set to `/tutor` —
  that is what `just package` does. A build that serves at `/` (`just package-root`)
  loads a blank page through that proxy, because its assets resolve outside the
  mount. Logs are in `~/Library/Logs/tutor.log` and `tutor.err.log`.
- Only changes in this repo need this. `data/` and `models/` are runtime state and
  are never rebuilt, and docs-only changes can skip it.
- `nix build` sees the git tree, so `git add` new files before deploying —
  untracked files are silently left out of the build.
- The `/tutor` route itself is declarative: `routes.tutor.port = 4318` under
  `services.tailnetGateway` in `~/nixos/hosts/Aarons-Mac-Mini/default.nix` (the
  gateway daemon runs `tailscale serve`). Only the app comes from this checkout.

`deploy/README.md` also documents a declarative `nix-darwin` variant (the
`services.tutor` launchd module, deployed with `sudo darwin-rebuild switch
--flake /etc/nix-darwin`). Use one approach or the other, never both — they fight
over port 4318.

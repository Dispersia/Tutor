# Hosting tutor on your Mac with HTTPS (Tailscale)

tutor is a PWA that needs a **secure context** for the phone's microphone, so it
must be served over HTTPS. On this Mac that comes from Tailscale (a real Let's
Encrypt cert for the `*.ts.net` name) via the **tailnet gateway**.

Your machine: **`aarons-mac-mini.tail7c1ddb.ts.net`** (tailnet `tail7c1ddb.ts.net`).

## A. Declarative — nix-darwin module (recommended)

This Mac is managed by nix-darwin with a `services.tailnetGateway` that mounts
apps at `/<name>` (Forge lives at `/forge` with `--subpath forge`). tutor is built
**subpath-aware** (`TUTOR_BASE_PATH=/tutor`) and mounted the same way:

```nix
# flake.nix inputs
inputs.tutor.url = "path:/Users/dispe/development/tutor";   # or a git ref

# hosts/<host>/default.nix
imports = [ inputs.tutor.darwinModules.default ];

services.tutor = {
  enable = true;
  environmentFile = "/Users/dispe/.config/tutor/env";   # OPENROUTER_API_KEY, TUTOR_SECRET
  basePath = "/tutor";
};

services.tailnetGateway.routes.tutor.port = config.services.tutor.port;
```

Then `sudo darwin-rebuild switch --flake /etc/nix-darwin` → **https://aarons-mac-mini.tail7c1ddb.ts.net/tutor/**.

The module adds a `launchd.user.agents.tutor` (runs as you, so it has your `$HOME`
where the MLX venv and weights live; `RunAtLoad` + `KeepAlive`; logs in
`<dataDir>/logs/`). Options: `package`, `host`, `port`, `dataDir`, `modelsDir`,
`environmentFile`, `basePath`, `tailscaleServe.{enable,httpsPort}`,
`caddy.{enable,hostname}`.

> Not using a tailnet gateway? Set `services.tutor.tailscaleServe.enable = true`
> (a `tailscale serve` agent serving the app at the tailnet root) or
> `caddy.{enable,hostname}` (a `tailscale cert` + `caddy run` pair). Don't combine
> these with a gateway route — they'd fight over the same Tailscale serve config.

## B. Ad-hoc — launchd agent + `just` recipes

For a machine without the declarative setup:

```bash
just package             # -> ./result/bin/tutor (the /tutor gateway build; see below)
just package-root        # the variant that serves at / (plain `tailscale serve`)
just service-install     # per-user launchd agent (starts at login, restarts on crash)
just tailscale-serve     # HTTPS on the tailnet (root path — needs the root build)
just tailscale-unserve   # turn it off
just service-uninstall   # remove the agent
```

> The base path is baked into the build. `just package` (`nix build`) is the
> **`/tutor` build**, for a tailnet gateway that mounts the app at `/tutor` — the
> setup `AGENTS.md` describes, and what `just service-install` installs.
> `tailscale serve` at the root (`just tailscale-serve`) needs the **root build**
> instead: `just package-root` (`nix build .#root`). Serving one build at the
> other's path loads a blank page, because its asset base does not match the URL.

The agent runs `deploy/tutor-serve.sh` (sets `TUTOR_DATA_DIR`, `TUTOR_MODELS_DIR`,
`TUTOR_HOST=127.0.0.1`), logs to `~/Library/Logs/tutor.log`.

> Don't run A and B at once — they'd fight over port 4318. If you adopt the module,
> run `just service-uninstall` so the declarative agent can bind.

## One-time setup

```bash
# model weights (~11 GB). The service uses <dataDir>/models; this Mac symlinks
# ~/.local/share/tutor/models at the checkout's ./models, so nothing to do.
TUTOR_MODELS_DIR=~/.local/share/tutor/models nix run .#fetch-models   # otherwise

# secrets (chmod 600)
cat > ~/.config/tutor/env <<'EOF'
OPENROUTER_API_KEY=sk-or-...
TUTOR_SECRET=<long random string>
EOF
chmod 600 ~/.config/tutor/env
```

## How it fits together

```
phone (tailnet) ──https──► tailscaled ──► 127.0.0.1:4318 (tutor)
  aarons-mac-mini.tail7c1ddb.ts.net/tutor/   (Tailscale terminates TLS)
```

- `tailscale serve` **strips the `/<name>` prefix** before forwarding, so the app
  is reached at `/`. It also serves it under `/tutor` directly (the server strips
  the prefix for that case), so `http://127.0.0.1:4318/tutor/` works too.
- The app trusts `X-Forwarded-Proto: https`, so session cookies are `Secure`.
- The app binds `127.0.0.1` only; the gateway is the only way in.
- Speech models start on demand and **unload when idle** (1 hour), giving the Mac
  its RAM back between sessions.

Open `https://aarons-mac-mini.tail7c1ddb.ts.net/tutor/` on your phone (Tailscale
connected) and install the PWA — the mic works because it's HTTPS.

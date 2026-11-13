# Hosting tutor on your Mac with HTTPS (Tailscale)

tutor is a PWA that needs a **secure context** for the phone's microphone, so it
must be served over HTTPS. This Mac is on your tailnet, so Tailscale issues a real
Let's Encrypt certificate for its `*.ts.net` name — no extra software required.

Your machine: **`aarons-mac-mini.tail7c1ddb.ts.net`** (tailnet `tail7c1ddb.ts.net`).

There are two ways to host it: **declaratively** (recommended, since your Mac is
managed by nix-darwin) or **ad-hoc** (a launchd agent + `just` recipes).

## A. Declarative — the nix-darwin module (recommended)

Add tutor as an input and import the module:

```nix
# flake.nix
inputs.tutor.url = "path:/Users/dispersias/development/tutor";
#   or a git ref, e.g. "github:dispersias/tutor"

# darwinConfigurations.<host>
imports = [ inputs.tutor.darwinModules.default ];
services.tutor = {
  enable = true;
  tailscaleServe.enable = true;              # HTTPS on your tailnet
  environmentFile = "/Users/dispersias/.config/tutor/env";  # OPENROUTER_API_KEY, TUTOR_SECRET
  # dataDir defaults to ~/.local/share/tutor; modelsDir to <dataDir>/models
};
```

Then `darwin-rebuild switch`. This declares:

- `launchd.user.agents.tutor` — the app, `RunAtLoad` + `KeepAlive`, logs in
  `<dataDir>/logs/`.
- `launchd.user.agents.tutor-tailscale` — `tailscale serve --https=443` → `127.0.0.1:4318`.

Prefer **Caddy** instead? Set:

```nix
services.tutor.caddy = { enable = true; hostname = "aarons-mac-mini.tail7c1ddb.ts.net"; };
```

That adds a `tutor-cert` agent (`tailscale cert` → real cert) and a `tutor-caddy`
agent (`caddy run` with a generated Caddyfile that reverse-proxies to the app).

Options: `enable`, `package`, `host`, `port`, `dataDir`, `modelsDir`,
`environmentFile`, `tailscaleServe.{enable,httpsPort}`, `caddy.{enable,hostname}`.

## B. Ad-hoc — launchd agent + `just` recipes

If you'd rather not touch your nix-darwin config yet:

```bash
nix build                # -> ./result/bin/tutor
just service-install     # per-user launchd agent (starts at login, restarts on crash)
just tailscale-serve     # HTTPS on the tailnet
just tailscale-unserve   # turn it off
just service-uninstall   # remove the agent
```

The agent runs `deploy/tutor-serve.sh` (sets `TUTOR_DATA_DIR`, `TUTOR_MODELS_DIR`,
`TUTOR_HOST=127.0.0.1`), logs to `~/Library/Logs/tutor.log`. This is what is
currently running on this machine.

> Note: don't run both A and B at once — they'd fight over port 4318 and the
> `tailscale serve` root path. If you adopt the module, `just service-uninstall`
> first.

## One-time setup

```bash
# model weights (~11 GB). The service uses <dataDir>/models; this Mac has a
# symlink there pointing at the repo's ./models, so nothing to do — otherwise:
TUTOR_MODELS_DIR=~/.local/share/tutor/models nix run .#fetch-models

# secrets (chmod 600)
mkdir -p ~/.config/tutor
cat > ~/.config/tutor/env <<'EOF'
OPENROUTER_API_KEY=sk-or-...
TUTOR_SECRET=<long random string>
EOF
chmod 600 ~/.config/tutor/env
```

## How HTTPS is served

```
phone (tailnet) ──https──► tailscaled  ──http──► 127.0.0.1:4318 (tutor)
   aarons-mac-mini.tail7c1ddb.ts.net        (Tailscale issues the cert)
```

- `tailscale serve` keeps per-path routes, so this coexists with anything else you
  serve (on this Mac `/forge` already maps to `127.0.0.1:7860`; tutor takes `/`).
- The app trusts `X-Forwarded-Proto: https`, so session cookies are `Secure` behind
  either proxy.
- The app binds to `127.0.0.1` only; the proxy is the only way in.
- The speech models start on demand and **unload when idle** (10 min), so the Mac
  gets its RAM back between sessions.

Open `https://aarons-mac-mini.tail7c1ddb.ts.net/` on your phone (Tailscale
connected) and install the PWA — the mic works because it's HTTPS.

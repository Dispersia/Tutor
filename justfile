set shell := ["bash", "-euo", "pipefail", "-c"]

# list recipes
default:
    @just --list

# regenerate the embedded migrations (for compiled builds)
gen:
    bun scripts/gen-migrations.mjs

# build the packaged app for the tailnet gateway (mounted at /tutor — the setup here)
package:
    nix build

# build the variant that serves at / for a plain `tailscale serve` deployment
package-root:
    nix build .#root

# run the packaged app (the /tutor gateway variant, matching `package`)
run:
    nix run

# install JS + Python dependencies
setup:
    bun install
    uv sync --project python

# pre-fetch the pinned MLX checkpoints into $TUTOR_MODELS_DIR
models:
    nix run .#fetch-models

# run the speech gateway (ASR + aligner + TTS) on its own
speech:
    cd python && uv run python -m speech.server

# measure ASR/TTS/aligner latency + peak RAM on this machine
bench:
    cd python && uv run python -m speech.bench

# start the API (serves the built PWA from apps/web/build)
dev:
    bun run --cwd apps/server dev

# start the SvelteKit dev server (proxies /api to the API on :4318)
dev-web:
    bun run --cwd apps/web dev

# build the PWA into apps/web/build
build:
    bun run --cwd apps/web build

# copy the Silero VAD weights + onnxruntime wasm into apps/web/static/vad
vad:
    bun run --cwd apps/web vad

# run tests
test:
    bun test

# typecheck the workspace (server + web)
check:
    bun run typecheck
    bun run --cwd apps/web check

# lint + architecture guardrails (docs/ARCHITECTURE.md)
lint:
    bun run lint
    bun run arch

# every gate in one go: format, lint, architecture, typecheck (server + web), tests
ci:
    bun run verify

# dead-code gate: unused files, exports, dependencies and unlisted binaries
knip:
    bun run knip

# format everything
fmt:
    bun run format

# create a locally-trusted HTTPS cert so the phone can use its mic (DESIGN §14.1)
certs:
    #!/usr/bin/env bash
    set -euo pipefail
    mkcert -install
    mkdir -p data/tls
    ip="$(ipconfig getifaddr en0 2>/dev/null || echo 127.0.0.1)"
    mkcert -cert-file data/tls/tutor.pem -key-file data/tls/tutor-key.pem \
      localhost 127.0.0.1 "$ip" "$(scutil --get LocalHostName 2>/dev/null || hostname)"
    echo "cert written to data/tls/tutor.pem (install the mkcert CA on the phone)"

# build + run the app in the foreground on http://127.0.0.1:4318
serve: package
    ./result/bin/tutor

# expose the app over HTTPS on your tailnet via Tailscale (no extra software)
tailscale-serve:
    #!/usr/bin/env bash
    set -euo pipefail
    host="$(tailscale status --json | jq -r .Self.DNSName | sed 's/\.$//')"
    tailscale serve --bg --https=443 http://127.0.0.1:4318
    echo "https://$host/"

# turn the Tailscale HTTPS proxy off
tailscale-unserve:
    tailscale serve --https=443 off || true

# get a Let's Encrypt cert for this machine's ts.net name (for Caddy)
tailscale-cert:
    #!/usr/bin/env bash
    set -euo pipefail
    host="$(tailscale status --json | jq -r .Self.DNSName | sed 's/\.$//')"
    cd deploy && tailscale cert "$host" && echo "wrote deploy/$host.crt and .key"

# run Caddy with the example config (run `just tailscale-cert` first)
caddy:
    #!/usr/bin/env bash
    set -euo pipefail
    host="$(tailscale status --json | jq -r .Self.DNSName | sed 's/\.$//')"
    TUTOR_HOSTNAME="$host" TUTOR_CERT="$PWD/deploy/$host.crt" TUTOR_KEY="$PWD/deploy/$host.key" \
      caddy run --config deploy/Caddyfile

# install a launchd agent so tutor starts at login and restarts on crash
service-install: package
    #!/usr/bin/env bash
    set -euo pipefail
    repo="$PWD"; label="dev.tutor.serve"
    plist="$HOME/Library/LaunchAgents/$label.plist"
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    sed -e "s|@REPO@|$repo|g" -e "s|@HOME@|$HOME|g" deploy/launchd.plist.template > "$plist"
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$plist"
    echo "installed $plist — logs in ~/Library/Logs/tutor.log"

# remove the launchd agent
service-uninstall:
    #!/usr/bin/env bash
    set -euo pipefail
    label="dev.tutor.serve"
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/$label.plist"
    echo "removed $label"

# build the current checkout and (re)start it — the dev iteration loop
#
# Rebuilds ./result from this checkout (the /tutor build), reinstalls/restarts
# the `dev.tutor.serve` agent so it picks up the new binary, and waits for
# /api/health. Re-run after every edit; the tailnet URL keeps working. See
# deploy/deploy.sh (and AGENTS.md).
deploy:
    ./deploy/deploy.sh

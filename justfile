set shell := ["bash", "-euo", "pipefail", "-c"]

# list recipes
default:
    @just --list

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

# run tests
test:
    bun test

# typecheck the workspace (server + web)
check:
    bun run typecheck
    bun run --cwd apps/web check

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

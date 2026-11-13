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

# start the API (and the web app once Phase 3 exists)
dev:
    bun run --cwd apps/server dev

# run tests
test:
    bun test

# typecheck the workspace
check:
    bun run typecheck

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

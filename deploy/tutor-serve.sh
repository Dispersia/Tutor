#!/usr/bin/env bash
# Runs the packaged tutor app on localhost for a reverse proxy (Caddy or
# `tailscale serve`) to terminate TLS in front of it.
#
# Build first:  nix build
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${TUTOR_BIN:-$REPO/result/bin/tutor}"

if [ ! -x "$BIN" ]; then
  echo "tutor: $BIN not found — run 'nix build' first" >&2
  exit 1
fi

export TUTOR_HOST="${TUTOR_HOST:-127.0.0.1}"
export TUTOR_PORT="${TUTOR_PORT:-4318}"
export TUTOR_DATA_DIR="${TUTOR_DATA_DIR:-$HOME/.local/share/tutor}"

# prefer a stable location; fall back to the repo's downloaded weights
if [ -z "${TUTOR_MODELS_DIR:-}" ]; then
  if [ -d "$TUTOR_DATA_DIR/models/hub" ]; then
    TUTOR_MODELS_DIR="$TUTOR_DATA_DIR/models"
  elif [ -d "$REPO/models/hub" ]; then
    TUTOR_MODELS_DIR="$REPO/models"
  else
    TUTOR_MODELS_DIR="$TUTOR_DATA_DIR/models"
  fi
fi
export TUTOR_MODELS_DIR

echo "tutor: serving http://$TUTOR_HOST:$TUTOR_PORT (data: $TUTOR_DATA_DIR, models: $TUTOR_MODELS_DIR)"
exec "$BIN"

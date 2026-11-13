{
  pkgs,
  lib,
  src,
}:
# Phase 0/1 shape: a thin launcher for the Bun server from the source tree.
# Phase 7 replaces this with `bun build --compile` + baked static assets.
pkgs.writeShellApplication {
  name = "tutor";
  runtimeInputs = [
    pkgs.bun
    pkgs.nodejs_24
    pkgs.ffmpeg
  ];
  text = ''
    export TUTOR_ROOT="${src}"
    export TUTOR_DATA_DIR="''${TUTOR_DATA_DIR:-$PWD/data}"
    exec bun "$TUTOR_ROOT/apps/server/src/index.ts" "$@"
  '';
}

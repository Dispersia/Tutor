{
  pkgs,
  lib,
  src,
}:
# Packages tutor as a self-contained artifact:
#   * the SvelteKit PWA, built with bun
#   * the Bun API compiled to a single binary (bun build --compile)
#   * the Python/MLX speech project, copied out of the store on first run
# Plus a `tutor` wrapper that sets up dirs, creates the speech venv (uv sync) and
# launches the binary. Model weights and the venv live in the data dir, never in
# the Nix store (see docs/DESIGN.md §15).
let
  bun = pkgs.bun;
  node = pkgs.nodejs_24;

  # Only manifests + the lockfile feed the dependency FOD, so *code* changes never
  # invalidate it (otherwise every commit would need a new hash).
  depsSrc = builtins.filterSource (
    path: type:
    type == "directory"
    || builtins.baseNameOf path == "package.json"
    || builtins.baseNameOf path == "bun.lock"
  ) src;

  # Fixed-output derivation: just the installed node_modules (needs network once).
  deps = pkgs.stdenvNoCC.mkDerivation {
    pname = "tutor-bun-deps";
    version = "0.0.0";
    src = depsSrc;
    nativeBuildInputs = [
      bun
      node
      pkgs.git
      pkgs.cacert
    ];
    dontConfigure = true;
    buildPhase = ''
      export HOME=$TMPDIR
      export BUN_INSTALL_CACHE_DIR=$TMPDIR/bun-cache
      bun install --frozen-lockfile --no-progress
    '';
    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      cp -r node_modules "$out/node_modules"
      for d in apps/* packages/*; do
        [ -d "$d" ] || continue
        if [ -d "$d/node_modules" ]; then
          mkdir -p "$out/$d"
          cp -r "$d/node_modules" "$out/$d/node_modules"
        fi
        # workspace symlinks (@tutor/core -> ../../packages/core) must not dangle,
        # so keep a stub manifest at each workspace path
        mkdir -p "$out/$d"
        printf '{"name":"stub","version":"0.0.0","private":true}' > "$out/$d/package.json"
      done
      runHook postInstall
    '';
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-kupurc5bMqrw5S1sQgVn1EHRejBy7aRqacJj3VDclBY=";
  };

  appFiles = pkgs.stdenvNoCC.mkDerivation {
    pname = "tutor";
    version = "0.1.0";
    inherit src;
    nativeBuildInputs = [
      bun
      node
    ];
    dontConfigure = true;
    buildPhase = ''
      runHook preBuild
      export HOME=$TMPDIR
      # merge in the pinned dependency tree (workspace symlinks stay relative)
      cp -r ${deps}/node_modules ./node_modules
      for d in apps/* packages/*; do
        if [ -d "${deps}/$d/node_modules" ]; then
          cp -r "${deps}/$d/node_modules" "$d/node_modules"
        fi
      done
      # store copies are read-only; SvelteKit writes generated types into node_modules
      chmod -R u+w node_modules
      for d in apps/* packages/*; do
        [ -d "$d/node_modules" ] && chmod -R u+w "$d/node_modules"
      done
      bun scripts/gen-migrations.mjs
      bun run --cwd apps/web build
      bun build --compile --minify apps/server/src/index.ts --outfile tutor
      runHook postBuild
    '';
    installPhase = ''
      runHook preInstall
      mkdir -p "$out/bin" "$out/share/tutor"
      cp tutor "$out/bin/tutor-server"
      cp -r apps/web/build "$out/share/tutor/web"
      cp -r python "$out/share/tutor/python"
      runHook postInstall
    '';
  };
in
pkgs.writeShellApplication {
  name = "tutor";
  runtimeInputs = [
    pkgs.uv
    pkgs.ffmpeg
    pkgs.cacert
    pkgs.git
  ];
  text = ''
    set -euo pipefail
    : "''${TUTOR_DATA_DIR:=$HOME/.local/share/tutor}"
    : "''${TUTOR_MODELS_DIR:=$TUTOR_DATA_DIR/models}"
    export TUTOR_DATA_DIR TUTOR_MODELS_DIR
    mkdir -p "$TUTOR_DATA_DIR" "$TUTOR_MODELS_DIR"
    export HF_HOME="$TUTOR_MODELS_DIR"
    export TUTOR_STATIC_DIR="${appFiles}/share/tutor/web"

    # The Python/MLX project must be writable (it grows a venv), so copy it out of
    # the read-only store on first run and let uv create the environment.
    PY="''${TUTOR_PYTHON_DIR:-$TUTOR_DATA_DIR/python}"
    if [ ! -f "$PY/pyproject.toml" ]; then
      echo "tutor: setting up the speech project in $PY"
      mkdir -p "$PY"
      cp -r "${appFiles}/share/tutor/python/." "$PY/"
      chmod -R u+w "$PY"
    fi
    if [ ! -d "$PY/.venv" ]; then
      echo "tutor: creating the speech environment (uv sync) — first run only"
      ( cd "$PY" && uv sync --no-progress )
    fi
    export TUTOR_PYTHON_DIR="$PY"

    if [ ! -d "$TUTOR_MODELS_DIR/hub" ]; then
      echo "tutor: no model weights found in $TUTOR_MODELS_DIR."
      echo "       run:  TUTOR_MODELS_DIR=$TUTOR_MODELS_DIR nix run .#fetch-models"
    fi

    exec "${appFiles}/bin/tutor-server" "$@"
  '';
}

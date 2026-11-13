{
  description = "tutor — AI-first language learning (local MLX speech + OpenRouter brain)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachSystem [ "aarch64-darwin" ] (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        py = pkgs.python312;
      in
      {
        # `nix develop` — everything needed for dev. MLX/Python deps are installed
        # into python/.venv by `just setup` (Metal can't run inside the sandbox).
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            nodejs_24
            uv
            py
            ffmpeg
            git
            cacert
            just
            sqlite
            pkg-config
            mkcert # local HTTPS so the Android phone can use its mic (§14.1)
          ];

          shellHook = ''
            export TUTOR_ROOT="${self}"
            export TUTOR_DATA_DIR="''${TUTOR_DATA_DIR:-$PWD/data}"
            export TUTOR_MODELS_DIR="''${TUTOR_MODELS_DIR:-$PWD/models}"
            export HF_HOME="$TUTOR_MODELS_DIR"
            # Make uv use the nix-provided Python 3.12 (MLX supports <= 3.13).
            export UV_PYTHON="${py}/bin/python3.12"
            export UV_PYTHON_PREFERENCE=only-system
            export SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
            echo "tutor dev shell"
            echo "  python: $(python3 --version 2>&1)  bun: $(bun --version)"
            echo "  next:   just setup && just models"
          '';
        };

        # Runnable artifact (dev-shape for now; hermetic bundling in Phase 7).
        packages.default = pkgs.callPackage ./nix/package.nix { src = self; };
        packages.speech = pkgs.callPackage ./nix/speech.nix { };

        apps.default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/tutor";
        };
        apps.fetch-models = {
          type = "app";
          program = "${self.packages.${system}.speech}/bin/tutor-fetch-models";
        };

        formatter = pkgs.nixfmt-rfc-style;

        checks.default = pkgs.runCommand "tutor-checks" { } ''
          echo "phase 0 scaffold ok"
          touch $out
        '';
      }
    );
}

{
  pkgs,
  lib,
}:
# Ships `tutor-fetch-models`, which pre-populates the Hugging Face cache with the
# pinned MLX checkpoints so the speech gateway can load them offline. Weights are
# never baked into the Nix store (multi-GB + must stay mutable), see DESIGN §15.
let
  repos = [
    "mlx-community/whisper-large-v3-turbo-asr-fp16"
    "mlx-community/VoxCPM2-8bit"
    "mlx-community/Qwen3-ForcedAligner-0.6B-8bit"
  ];

  fetch = pkgs.writeShellApplication {
    name = "tutor-fetch-models";
    runtimeInputs = [
      pkgs.uv
      pkgs.cacert
      pkgs.git
    ];
    text = ''
      set -euo pipefail
      dir="''${TUTOR_MODELS_DIR:-$HOME/.local/share/tutor/models}"
      mkdir -p "$dir"
      export HF_HOME="$dir"
      for repo in ${lib.concatStringsSep " " repos}; do
        echo "==> fetching $repo"
        uvx --from huggingface_hub hf download "$repo"
      done
      echo "done — checkpoints cached under $HF_HOME/hub"
    '';
  };
in
pkgs.symlinkJoin {
  name = "tutor-speech";
  paths = [ fetch ];
}

# nix-darwin module for tutor.
#
#   # flake.nix
#   inputs.tutor.url = "path:/Users/dispersias/development/tutor";   # or github:...
#   # darwinConfiguration
#   imports = [ inputs.tutor.darwinModules.default ];
#   services.tutor = {
#     enable = true;
#     tailscaleServe.enable = true;      # HTTPS on your tailnet, no extra software
#     # caddy.enable = true; caddy.hostname = "aarons-mac-mini.tail7c1ddb.ts.net";
#     environmentFile = "/Users/dispersias/.config/tutor/env";  # OPENROUTER_API_KEY, TUTOR_SECRET
#   };
#
# Runs tutor as a per-user launchd agent (so it has your $HOME, where the MLX venv
# and model weights live) and, optionally, fronts it with HTTPS.
{ self }:
{ config, lib, pkgs, ... }:
let
  cfg = config.services.tutor;
  inherit (lib) mkIf mkEnableOption mkOption types optionalString;

  dataDir = cfg.dataDir;
  modelsDir = if cfg.modelsDir != null then cfg.modelsDir else "${dataDir}/models";
  httpsPort = toString cfg.tailscaleServe.httpsPort;

  baseEnv = {
    TUTOR_HOST = cfg.host;
    TUTOR_PORT = toString cfg.port;
    TUTOR_DATA_DIR = dataDir;
    TUTOR_MODELS_DIR = modelsDir;
  };

  # launchd runs this through /bin/sh; source an env file if given, then exec.
  tutorScript = ''
    ${optionalString (cfg.environmentFile != null) ''
      set -a
      . ${cfg.environmentFile}
      set +a
    ''}
    exec ${cfg.package}/bin/tutor
  '';
in
{
  options.services.tutor = {
    enable = mkEnableOption "tutor — AI language learning with local MLX speech";

    package = mkOption {
      type = types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      defaultText = lib.literalExpression "tutor.packages.\${system}.default";
      description = "The tutor package to run.";
    };

    host = mkOption {
      type = types.str;
      default = "127.0.0.1";
      description = "Interface to bind. Keep this on loopback and let the proxy handle TLS.";
    };

    port = mkOption {
      type = types.port;
      default = 4318;
      description = "Port for the tutor app.";
    };

    dataDir = mkOption {
      type = types.str;
      default = "/Users/${config.system.primaryUser}/.local/share/tutor";
      description = "Where SQLite, audio history, the speech venv and (by default) models live.";
    };

    modelsDir = mkOption {
      type = types.nullOr types.str;
      default = null;
      description = "MLX model cache. Defaults to <dataDir>/models.";
    };

    environmentFile = mkOption {
      type = types.nullOr types.path;
      default = null;
      example = "/Users/dispersias/.config/tutor/env";
      description = "File with OPENROUTER_API_KEY and TUTOR_SECRET (sourced before launch).";
    };

    tailscaleServe = {
      enable = mkEnableOption "HTTPS on the tailnet via `tailscale serve` (no extra software)";
      httpsPort = mkOption {
        type = types.port;
        default = 443;
        description = "Tailnet HTTPS port to expose the app on.";
      };
    };

    caddy = {
      enable = mkEnableOption "Caddy HTTPS reverse proxy (uses a Tailscale-issued certificate)";
      hostname = mkOption {
        type = types.str;
        default = "";
        example = "aarons-mac-mini.tail7c1ddb.ts.net";
        description = "The tailnet hostname to serve. Required when caddy.enable is true.";
      };
    };
  };

  config = mkIf cfg.enable {
    assertions = [
      {
        assertion = !cfg.caddy.enable || cfg.caddy.hostname != "";
        message = "services.tutor.caddy.hostname must be set when services.tutor.caddy.enable is true.";
      }
    ];

    # prepare writable dirs before launchd writes logs / venv / certs
    system.activationScripts.tutorDataDir.text = ''
      mkdir -p ${dataDir} ${dataDir}/logs ${dataDir}/certs
    '';

    launchd.user.agents.tutor = {
      script = tutorScript;
      environment = baseEnv;
      serviceConfig = {
        RunAtLoad = true;
        KeepAlive = true;
        WorkingDirectory = dataDir;
        StandardOutPath = "${dataDir}/logs/tutor.log";
        StandardErrorPath = "${dataDir}/logs/tutor.err.log";
      };
    };

    # --- HTTPS: Tailscale serve (recommended) --------------------------------
    launchd.user.agents.tutor-tailscale = mkIf cfg.tailscaleServe.enable {
      script = ''
        exec ${pkgs.tailscale}/bin/tailscale serve --bg --https=${httpsPort} http://${cfg.host}:${toString cfg.port}
      '';
      serviceConfig.RunAtLoad = true;
    };

    # --- HTTPS: Caddy -------------------------------------------------------
    system.activationScripts.tutorCaddyfile.text = mkIf cfg.caddy.enable ''
      cat > ${dataDir}/Caddyfile <<'CADDY'
      https://${cfg.caddy.hostname} {
        tls ${dataDir}/certs/${cfg.caddy.hostname}.crt ${dataDir}/certs/${cfg.caddy.hostname}.key
        encode zstd gzip
        reverse_proxy ${cfg.host}:${toString cfg.port}
      }
      CADDY
    '';

    launchd.user.agents.tutor-cert = mkIf cfg.caddy.enable {
      script = ''
        exec ${pkgs.tailscale}/bin/tailscale cert \
          --cert-file ${dataDir}/certs/${cfg.caddy.hostname}.crt \
          --key-file ${dataDir}/certs/${cfg.caddy.hostname}.key \
          ${cfg.caddy.hostname}
      '';
      serviceConfig.RunAtLoad = true;
    };

    launchd.user.agents.tutor-caddy = mkIf cfg.caddy.enable {
      script = ''
        # wait for the Tailscale certificate, then serve
        until [ -f ${dataDir}/certs/${cfg.caddy.hostname}.crt ]; do sleep 2; done
        exec ${pkgs.caddy}/bin/caddy run --config ${dataDir}/Caddyfile
      '';
      serviceConfig = {
        RunAtLoad = true;
        KeepAlive = true;
        StandardOutPath = "${dataDir}/logs/caddy.log";
        StandardErrorPath = "${dataDir}/logs/caddy.err.log";
      };
    };
  };
}

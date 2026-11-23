#!/usr/bin/env bash
# Build this checkout and (re)start the `dev.tutor.serve` launchd agent so the
# tailnet URL serves the current code. This is the iteration loop on this Mac
# (see AGENTS.md):
#
#     ./deploy/deploy.sh
#
# Steps: `nix build` (the /tutor variant) -> install/restart the agent -> wait
# for /api/health. Retires the old declarative `org.nixos.tutor` agent (the
# services.tutor module) if it is still loaded, so the two never fight over
# port 4318.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
label="dev.tutor.serve"
plist="$HOME/Library/LaunchAgents/$label.plist"

echo "==> nix build ($REPO)"
nix build --print-build-logs

# retire the old nix-darwin agent (services.tutor) if it is still loaded
if launchctl print "gui/$(id -u)/org.nixos.tutor" >/dev/null 2>&1; then
  echo "==> removing the old declarative agent (org.nixos.tutor)"
  launchctl bootout "gui/$(id -u)/org.nixos.tutor" || true
fi
rm -f "$HOME/Library/LaunchAgents/org.nixos.tutor.plist"

echo "==> (re)installing $label"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
sed -e "s|@REPO@|$REPO|g" -e "s|@HOME@|$HOME|g" \
  "$REPO/deploy/launchd.plist.template" > "$plist"
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
sleep 1 # let the old process release :4318
launchctl bootstrap "gui/$(id -u)" "$plist"

echo "==> waiting for /api/health"
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null http://127.0.0.1:4318/api/health 2>/dev/null && break
  sleep 1
done
if ! curl -fsS -o /dev/null http://127.0.0.1:4318/api/health 2>/dev/null; then
  echo "tutor: /api/health did not answer — see ~/Library/Logs/tutor.err.log" >&2
  exit 1
fi

host="$(tailscale status --json 2>/dev/null | jq -r .Self.DNSName 2>/dev/null | sed 's/\.$//' || true)"
echo "deployed tutor — https://${host:-<tailnet-host>}/tutor/"

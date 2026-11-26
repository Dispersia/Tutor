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

uid="$(id -u)"

load_agent() {
  for _ in 1 2 3 4 5; do
    for d in "user/$uid" "gui/$uid"; do
      if launchctl bootstrap "$d" "$plist" 2>/dev/null; then
        echo "==> loaded $label into $d"
        return 0
      fi
    done
    sleep 2 # the old process may still be releasing :4318
  done
  return 1
}

# retire the old nix-darwin agent (services.tutor) if it is still loaded
for d in "user/$uid" "gui/$uid"; do
  if launchctl print "$d/org.nixos.tutor" >/dev/null 2>&1; then
    echo "==> removing the old declarative agent (org.nixos.tutor) from $d"
    launchctl bootout "$d/org.nixos.tutor" || true
  fi
done
rm -f "$HOME/Library/LaunchAgents/org.nixos.tutor.plist"

echo "==> (re)installing $label"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
sed -e "s|@REPO@|$REPO|g" -e "s|@HOME@|$HOME|g" \
  "$REPO/deploy/launchd.plist.template" > "$plist"
# The Mac is normally headless (no Aqua session), so the agent lives in the
# per-user domain; fall back to gui/ for a logged-in desktop session.
for d in "user/$uid" "gui/$uid"; do
  launchctl bootout "$d/$label" 2>/dev/null || true
done
sleep 1 # let the old process release :4318
if ! load_agent; then
  echo "tutor: could not load $label into user/$uid or gui/$uid" >&2
  exit 1
fi

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

#!/usr/bin/env bash
# Agent Monitor — install autostart (systemd user timer; cron fallback).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

command -v node >/dev/null || { echo "ERROR: node not found on PATH"; exit 1; }
[ -f "$DIR/.env" ] || { echo "ERROR: $DIR/.env missing (copy env.example)"; exit 1; }

if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/agent-monitor.service" <<EOF
[Unit]
Description=Agent Monitor capture run

[Service]
Type=oneshot
WorkingDirectory=$DIR
ExecStart=$(command -v node) $DIR/agent.js
EOF
  cat > "$HOME/.config/systemd/user/agent-monitor.timer" <<EOF
[Unit]
Description=Agent Monitor: at boot + every 15 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now agent-monitor.timer
  echo "Installed systemd user timer. Verify: systemctl --user list-timers agent-monitor.timer"
else
  TMP="$(mktemp)"
  crontab -l 2>/dev/null | grep -v '# agent-monitor$' > "$TMP" || true
  echo "@reboot bash $DIR/start.sh >> /tmp/agent-monitor.log 2>&1 # agent-monitor" >> "$TMP"
  echo "*/15 * * * * bash $DIR/start.sh >> /tmp/agent-monitor.log 2>&1 # agent-monitor" >> "$TMP"
  crontab "$TMP"
  rm -f "$TMP"
  echo "Installed cron entries. Verify: crontab -l | grep agent-monitor"
fi

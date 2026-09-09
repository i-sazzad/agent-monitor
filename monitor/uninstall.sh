#!/usr/bin/env bash
# Agent Monitor — remove autostart entries installed by install.sh.
set -euo pipefail

if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  systemctl --user disable --now agent-monitor.timer 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/agent-monitor.service" \
        "$HOME/.config/systemd/user/agent-monitor.timer"
  systemctl --user daemon-reload
fi
TMP="$(mktemp)"
crontab -l 2>/dev/null | grep -v '# agent-monitor$' > "$TMP" || true
crontab "$TMP" 2>/dev/null || true
rm -f "$TMP"
echo "Removed Agent Monitor autostart entries."

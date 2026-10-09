#!/usr/bin/env bash
# Install the GoleSync agent for the current user (no root needed except for apt packages).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$HOME/.local/share/golesync/venv"
BIN="$HOME/.local/bin"
UNIT_DIR="$HOME/.config/systemd/user"

for tool in xdotool xclip notify-send; do
  command -v "$tool" >/dev/null || echo "WARNING: '$tool' not found. Install: sudo apt install xdotool xclip libnotify-bin"
done
if [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then
  echo "WARNING: you are on Wayland. Remote control needs an X11 session (choose 'on Xorg' at the login screen)."
fi

python3 -m venv "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -r "$HERE/requirements.txt"
"$VENV/bin/pip" install --quiet --no-deps "$HERE"

mkdir -p "$BIN" "$UNIT_DIR"
ln -sf "$VENV/bin/golesync" "$BIN/golesync"
ln -sf "$VENV/bin/gsync" "$BIN/gsync"
install -m 644 "$HERE/systemd/golesync.service" "$UNIT_DIR/golesync.service"

"$VENV/bin/golesync" init
systemctl --user daemon-reload
systemctl --user import-environment DISPLAY XAUTHORITY || true
systemctl --user enable --now golesync.service

echo
echo "Installed. Make sure $BIN is on your PATH, then pair your phone:"
echo "    golesync pair"
echo "Status:  systemctl --user status golesync   |   Logs: journalctl --user -u golesync -f"

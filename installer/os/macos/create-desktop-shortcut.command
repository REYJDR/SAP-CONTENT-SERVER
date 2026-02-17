#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
TARGET="$ROOT_DIR/installer/os/macos/start-installer-ui.command"
LINK_PATH="$HOME/Desktop/SAP Content Server Installer UI.command"

if [[ ! -f "$TARGET" ]]; then
  echo "[ERROR] Launcher not found: $TARGET"
  exit 20
fi

chmod +x "$TARGET"
ln -sf "$TARGET" "$LINK_PATH"
chmod +x "$LINK_PATH"

echo "Desktop shortcut created: $LINK_PATH"
exit 0

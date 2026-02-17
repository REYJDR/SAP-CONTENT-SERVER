#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] npm not found. Please install Node.js and npm."
  exit 10
fi

echo "Starting SAP Content Server Installer UI..."
npm run installer:ui &
SERVER_PID=$!

sleep 2
open "http://127.0.0.1:5055"

echo "Installer UI launched at http://127.0.0.1:5055"
echo "Server PID: $SERVER_PID"
echo "Press Ctrl+C to stop the UI server."

wait "$SERVER_PID"

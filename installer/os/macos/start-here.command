#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found. Please install Node.js first."
  exit 10
fi

echo "Starting SAP Content Server Installer..."
node installer/start-here.js

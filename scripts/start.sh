#!/usr/bin/env bash
# Start Vite dev server for app/client
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT="$ROOT/app/client"

cd "$CLIENT"

if [ ! -d node_modules ]; then
  echo "[start] node_modules missing — running npm install"
  npm install
fi

echo "[start] vite dev → http://localhost:5173/"
exec npm run dev -- "$@"

#!/usr/bin/env bash
set -e

# Resolve the project root relative to this script's location so it works
# in both Docker (/app) and Render native (/opt/render/project/src).
ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── 1. DB schema push ────────────────────────────────────────────────────────
npx --yes pnpm@10 --filter @workspace/db run push-force

# ── 2. Start the Python Miruro sidecar ──────────────────────────────────────
echo "[start.sh] Starting Miruro sidecar..."
cd "$ROOT/artifacts/miruro-sidecar"

python3 -m uvicorn main:app --host 127.0.0.1 --port 8090 --loop asyncio &
SIDECAR_PID=$!

# Wait up to 15s for the sidecar port to open
ATTEMPTS=0
until python3 -c "import socket; s=socket.socket(); s.connect(('127.0.0.1',8090)); s.close()" 2>/dev/null; do
  ATTEMPTS=$((ATTEMPTS+1))
  if [ $ATTEMPTS -ge 30 ]; then
    echo "[start.sh] WARNING: sidecar did not bind after 15s — continuing anyway"
    break
  fi
  sleep 0.5
done
echo "[start.sh] Sidecar ready (pid=$SIDECAR_PID)"

# ── 3. Start the Node API server (foreground — keeps the process alive) ──────
cd "$ROOT"
exec node artifacts/api-server/dist/index.mjs

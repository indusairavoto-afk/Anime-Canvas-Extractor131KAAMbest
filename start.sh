#!/usr/bin/env sh
set -e

# ── 1. DB schema push ────────────────────────────────────────────────────────
pnpm --filter @workspace/db run push-force

# ── 2. Start the Python Miruro sidecar ──────────────────────────────────────
echo "[start.sh] Starting Miruro sidecar..."
cd /app/artifacts/miruro-sidecar

# Run uvicorn in background, pipe output to main stdout so Render captures it
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

# ── 3. Start the Node API server (foreground — keeps the container alive) ───
cd /app
exec node artifacts/api-server/dist/index.mjs

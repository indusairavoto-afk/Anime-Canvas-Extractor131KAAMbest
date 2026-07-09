# Nexa Anime

An anime streaming and discovery site with a React/Vite frontend and an Express API backend, structured as a pnpm monorepo.

## Stack

- **Frontend** (`artifacts/anime-site`): React 19, Vite, Tailwind CSS, shadcn/ui, TanStack Query, wouter
- **Backend** (`artifacts/api-server`): Express 5, Drizzle ORM, PostgreSQL, WebSockets (watch-together)
- **DB schema** (`lib/db`): Drizzle Kit, PostgreSQL (Replit built-in)
- **Python sidecar** (`artifacts/miruro-sidecar`): FastAPI + uvicorn + curl_cffi; handles Miruro TLS/CF bypass on port 8090

## First-time setup

After cloning or importing, install all workspace dependencies once:

```
pnpm install
```

This installs packages for all 10 workspace projects (frontend, API server, shared libs, etc.).

## Running the project

The "Start application" workflow runs all three servers in parallel:

```
pnpm install --frozen-lockfile && pnpm --filter @workspace/db run push && \
(cd artifacts/miruro-sidecar && pip install -q -r requirements.txt && \
  /home/runner/workspace/.pythonlibs/bin/uvicorn main:app --host 127.0.0.1 --port 8090 --loop asyncio > /tmp/miruro-sidecar.log 2>&1 &) && \
(PORT=8080 bash -c 'cd artifacts/api-server && pnpm run dev' & \
 PORT=5000 pnpm --filter @workspace/anime-site run dev)
```

The schema push (`pnpm --filter @workspace/db run push`) runs automatically on every startup — it's idempotent and safe to re-run.

- Frontend: http://localhost:5000 (proxied externally)
- API: http://localhost:8080
- Python Miruro sidecar: http://127.0.0.1:8090 (internal only — logs at `/tmp/miruro-sidecar.log`)
- Frontend proxies `/api` and `/ws` to the API server automatically

## Miruro stream bypass (Cloudflare Worker)

Miruro's Cloudflare firewall hard-blocks Replit IPs. The fix is a free Cloudflare Worker that proxies the requests — CF edge IPs are never blocked by CF itself.

**One-time deploy (~2 minutes):**
```bash
cd workers/miruro-relay
npm install
npx wrangler login      # opens browser — free CF account needed
npx wrangler secret put RELAY_SECRET   # any random string
npx wrangler deploy     # prints the Worker URL
```

**Then set these Replit secrets:**
- `MIRURO_RELAY_URL` — the Worker URL (e.g. `https://miruro-relay.you.workers.dev`)
- `MIRURO_RELAY_SECRET` — same value you gave `wrangler secret put`

Restart the workflow after setting secrets. See `workers/miruro-relay/README.md` for full details.

## Database

Uses Replit's built-in PostgreSQL (`DATABASE_URL` is pre-set in the environment).

To push schema changes:
```
pnpm --filter @workspace/db run push
```

## Deployment

Builds the frontend and API, then runs the compiled API server which serves the built frontend as static files:
```
node artifacts/api-server/dist/index.mjs
```

## Current setup status

- `MIRURO_RELAY_URL` — set (points at `https://miruro-relay.indusairavoto.workers.dev/`)
- `MIRURO_RELAY_SECRET` — set (matches the Cloudflare Worker's `RELAY_SECRET`)
- Database schema — pushed to Replit PostgreSQL via `pnpm --filter @workspace/db run push`

## User preferences

- Keep the existing monorepo structure (artifacts/ for apps, lib/ for shared packages)
- Use pnpm workspaces; do not use npm or yarn

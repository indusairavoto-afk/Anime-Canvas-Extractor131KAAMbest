# Nexa Anime

An anime streaming and discovery platform with trending charts, episode streaming, manga reading, and watch-together rooms.

## Architecture

**pnpm monorepo** with three runtime processes:

| Service | Port | Path |
|---------|------|------|
| React frontend (Vite) | 5000 | `artifacts/anime-site` |
| Express API server | 8080 | `artifacts/api-server` |
| Python sidecar (FastAPI + curl_cffi) | 8090 | `artifacts/miruro-sidecar` |

Shared Drizzle ORM schema lives in `lib/db`. A Cloudflare Worker in `workers/miruro-relay` proxies requests that Replit IPs cannot reach directly.

## How to run

The **Start application** workflow handles everything:
1. `pnpm install --frozen-lockfile`
2. `pnpm --filter @workspace/db run push` — applies DB schema migrations
3. Starts the Python sidecar, API server, and frontend in parallel

## Required secrets

| Secret | Purpose |
|--------|---------|
| `MIRURO_RELAY_URL` | URL of the Cloudflare Worker relay |
| `MIRURO_RELAY_SECRET` | Shared auth secret for the relay |

The database (`DATABASE_URL`) is provided automatically by Replit.

## Key dependencies

- React 19, Vite 7, Tailwind CSS v4, shadcn/ui, TanStack Query, wouter
- Express 5, Drizzle ORM, PostgreSQL, pino
- Python: FastAPI, curl_cffi, uvicorn

## User preferences

<!-- Add user preferences here as they are confirmed -->

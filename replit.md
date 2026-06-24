# Nexa Anime

An anime streaming and community platform featuring anime/manga browsing, video playback (HLS/DASH), watchlists, user profiles, a community forum, and Watch Together real-time sync.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/anime-site run dev` — run the frontend Vite dev server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (provisioned via Replit database)

## Stack

- pnpm workspaces, Node.js 20, TypeScript 5.9
- Frontend: React 19, Vite, Tailwind CSS 4, Wouter, TanStack Query, Framer Motion
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Video: hls.js, dashjs
- WebSocket: ws (for Watch Together feature)

## Where things live

- `artifacts/anime-site/` — React frontend (Vite)
- `artifacts/api-server/` — Express API server
- `lib/db/` — Drizzle schema + DB connection (`DATABASE_URL`)
- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/api-client-react/` — generated React Query hooks
- `lib/api-zod/` — generated Zod schemas
- `scripts/` — utility/maintenance scripts

## Architecture decisions

- API server serves built frontend static files in production (single deployment unit); in dev, Vite proxies `/api` to port 8080
- Auth is custom bcrypt-based (register/login/reset) stored in PostgreSQL — no external auth provider
- Watch Together uses WebSocket attached to the same HTTP server
- External anime data comes from public APIs (AniList, GogoAnime, MangaDex, etc.) — no paid API keys required

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The API server port is 8080 in dev; the Vite frontend on port 5000 proxies `/api` to it
- Always run `pnpm --filter @workspace/db run push` after schema changes
- Run `pnpm --filter @workspace/api-spec run codegen` after changing `openapi.yaml`

# Nexa Anime

A full-stack anime streaming site built as a pnpm monorepo.

## Stack

- **Frontend:** React 19, Vite, Tailwind CSS 4, Wouter, TanStack Query, Framer Motion
- **Backend:** Express 5 (Node.js 20), port 8080
- **Database:** PostgreSQL (Replit-managed) with Drizzle ORM
- **Package manager:** pnpm workspaces

## Monorepo layout

```
artifacts/anime-site/   # React frontend (Vite, port 5000)
artifacts/api-server/   # Express API server (port 8080)
lib/db/                 # Drizzle schema + DB config
lib/api-spec/           # OpenAPI spec (openapi.yaml)
lib/api-client-react/   # Generated React query hooks (via Orval)
lib/api-zod/            # Generated Zod schemas (via Orval)
```

## How to run

The single "Start application" workflow starts both services:

```
PORT=8080 pnpm --filter @workspace/api-server run dev & PORT=5000 pnpm --filter @workspace/anime-site run dev
```

- Frontend dev server: http://localhost:5000 (Vite proxies `/api` → port 8080)
- API server: http://localhost:8080

## Database

`DATABASE_URL` is provisioned automatically by Replit. To push schema changes:

```bash
pnpm --filter @workspace/db run push
```

After changing `lib/api-spec/openapi.yaml`, regenerate client code:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## Environment secrets

- `SESSION_SECRET` — required for session signing (set in Replit Secrets)
- `DATABASE_URL` — managed automatically by Replit

## User preferences

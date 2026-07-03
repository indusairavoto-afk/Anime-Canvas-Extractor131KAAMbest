# Nexa Anime

An anime streaming and discovery site with a React/Vite frontend and an Express API backend, structured as a pnpm monorepo.

## Stack

- **Frontend** (`artifacts/anime-site`): React 19, Vite, Tailwind CSS, shadcn/ui, TanStack Query, wouter
- **Backend** (`artifacts/api-server`): Express 5, Drizzle ORM, PostgreSQL, WebSockets (watch-together)
- **DB schema** (`lib/db`): Drizzle Kit, PostgreSQL (Replit built-in)

## Running the project

The "Start application" workflow runs both servers in parallel:

```
PORT=8080 pnpm --filter @workspace/api-server run dev &
PORT=5000 pnpm --filter @workspace/anime-site run dev
```

- Frontend: http://localhost:5000 (proxied to port 80 externally)
- API: http://localhost:8080 (proxied to port 8080 externally)
- Frontend proxies `/api` and `/ws` to the API server automatically

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

## User preferences

- Keep the existing monorepo structure (artifacts/ for apps, lib/ for shared packages)
- Use pnpm workspaces; do not use npm or yarn

---
name: Duplicate artifact workflows serve stale code
description: This project has both a combined "Start application" workflow and separate per-artifact workflows (artifacts/api-server, artifacts/anime-site, artifacts/mockup-sandbox) all running simultaneously; the real user-facing preview goes through the per-artifact ones.
---

The repl has 3 registered artifacts (API Server, Anime Canvas web, Canvas design), each with its own Replit-managed workflow, running *alongside* a legacy combined "Start application" workflow. All four run at once.

The user's actual browser preview (artifact preview URL) is served by `artifacts/anime-site: web` (vite, falls back off port 5000 to a random port like 19796 if 5000 is taken) + `artifacts/api-server: API Server` (port 8082) — NOT by "Start application" (port 5000/8080).

**Why this matters:** restarting only "Start application" after a backend code change does NOT update the code the user actually sees. The two API server processes (8080 vs 8082) are independent node processes from independent builds; fixing a route and restarting one leaves the other stale, silently returning 404s that get swallowed as "no data" by frontend fallback logic — looks like a frontend bug but is actually a stale-backend-process bug.

**How to apply:** after any `artifacts/api-server` backend change, restart BOTH `Start application` and `artifacts/api-server: API Server` (and `artifacts/anime-site: web` if frontend proxy/env-driven API base differs) before concluding a fix didn't work. Prefer checking `ss -ltnp`/`lsof` for actual listening ports + `ps aux` for duplicate processes when a fix "should have worked" but the browser still shows old behavior.

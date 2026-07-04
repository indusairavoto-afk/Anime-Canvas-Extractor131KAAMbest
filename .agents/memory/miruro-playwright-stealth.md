---
name: Miruro Playwright + stealth CF bypass
description: How the CF bypass is implemented across the relay and api-server after the playwright-extra upgrade.
---

# Miruro CF Bypass — Playwright + Stealth

## Architecture

Two bypass paths:
1. **api-server** (`src/lib/miruro-cf-solver.ts`) — used when no relay configured. Uses `puppeteer-extra` + `puppeteer-extra-plugin-stealth` + system Chromium + CF extension. Falls back via `MIRURO_PROXY_URL` env.
2. **miruro-relay** (`src/cf-bypass.ts`) — used when relay deployed externally. Uses `playwright-extra` + `puppeteer-extra-plugin-stealth`. Falls back via `PROXY_URL` env.

## Key decisions

**Why external in esbuild:**
Both `puppeteer-extra` and `puppeteer-extra-plugin-stealth` have CJS dependencies (`clone-deep → kind-of`) that use dynamic `require()` and do NOT bundle cleanly with esbuild. Must be in the `external: [...]` array in BOTH `artifacts/api-server/build.mjs` AND `artifacts/miruro-relay/build.mjs`. The relay also externalizes `undici` (ProxyAgent has native bindings).

**Why:** Without externaling, the api-server crashes at startup with `Cannot find module 'kind-of'`.

**Proxy auth:**
- Chromium's `--proxy-server` flag accepts `host:port` only (no credentials).
- Credentials must be split out: parse URL, pass `server` to `--proxy-server` arg, pass `username`/`password` to `browser.newContext({ proxy: { server, username, password } })` (Playwright) or `page.authenticate({ username, password })` (Puppeteer).
- For plain `fetch()` in the relay, use `undici.ProxyAgent` which handles auth natively.

**Cookie persistence:**
- CF clearance cookies saved to `/tmp/miruro-cf-session.json` (api-server) and `/tmp/miruro-cf-cookies.json` (relay).
- On startup, disk cache is checked first — avoids re-launching browser on hot restarts.

**Body drain before retry:**
- On 403, MUST call `upstream.body?.cancel()` before issuing retry or the connection pool leaks open sockets.

**How:**
- Apply when `PROXY_URL` (relay) or `MIRURO_PROXY_URL` (api-server) env vars are set.

---
name: Miruro proxy health fix
description: The miruro proxy injected script must route /health and /random-pool.json through PASS or the SPA breaks in two cascading ways.
---

# Miruro proxy /health routing

## The rule
The injected `rewriteUrl()` function in `/api/miruro/proxy` must include:
```javascript
if (url.startsWith('/health') || url.startsWith('/random-pool.json')) {
  return PASS + url;
}
```

## Why
miruro.bz's SPA calls `fetch('/health?_t=...')` on every render via its health monitor. In our proxied iframe this hits **our** server, which returns 404. That triggers two cascading failures:

1. `isError = true` → `N.loading("Server unreachable...", {duration: Infinity})` toast shown permanently
2. Crypto init is blocked (the health check is a prerequisite for the JWKS/secure-pipe setup) → SPA falls back to `makePlainRequest` → calls `/api/episodes?anilistId=...` → miruro backend returns `{"error":"Gone"}` → "Couldn't find episodes"

When `/health` is correctly routed to `https://www.miruro.bz/health` (returns `{"status":"ok",...}`), both issues are resolved: no toast, crypto initialises, episode list populates fully, and `/api/secure/pipe` (the encrypted episode-source endpoint) is called successfully.

## How to apply
Any time the miruro proxy `routerFix` script is modified, ensure the `/health` and `/random-pool.json` rules are present in `rewriteUrl()`, **after** the `/api/` rule and **before** the final `return url`.

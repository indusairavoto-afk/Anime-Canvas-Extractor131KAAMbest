---
name: Miruro relay request shape matters
description: The deployed Cloudflare Worker relay (miruro-relay) can 403 on some URL shapes while succeeding on others; test with real API/watch endpoints, not the bare homepage.
---

Testing `GET /relay?url=https://www.miruro.bz/` (bare homepage) against the deployed
Cloudflare Worker relay returned a Cloudflare "Attention Required" 403, even with the
correct `x-relay-secret`. This looked like the relay itself was CF-blocked.

However, the actual app flow — `/api/miruro/native-stream?anilistId=<id>&ep=<n>` — worked
fine and returned a valid CDN URL through the same relay. The homepage root path apparently
triggers a stricter CF WAF rule (bot/challenge page) than the API/watch endpoints Miruro's
own frontend calls.

**Why:** `miruroFetch()` in `artifacts/api-server/src/lib/miruro-relay.ts` only falls back to
the CF session solver on a `401` from the relay — any other status (including a CF-block
`403`) is returned to the caller as-is. So if the relay *is* blocked for a given path, the app
won't automatically recover via the local Puppeteer/stealth solver; it'll just surface the
block.

**How to apply:** When verifying a newly configured `MIRURO_RELAY_URL`/`MIRURO_RELAY_SECRET`,
don't judge relay health from a raw homepage fetch — test against a real endpoint the app
actually uses (e.g. `native-stream`/`direct-url`). If a specific path 403s through the relay
while real streaming endpoints succeed, the relay is fine; the homepage path is just not
representative.

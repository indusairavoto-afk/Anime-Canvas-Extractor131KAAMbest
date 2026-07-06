---
name: Miruro blocked-CDN fast fallback
description: How uwucdn.top/owocdn.top IP-blocked CDNs are detected server-side and routed to the SW iframe path without HLS.js retry delay.
---

The CDNs `uwucdn.top` and `owocdn.top` are IP-blocked from Replit's server but reachable from users' browsers. The fix is a three-layer chain:

1. **API server** (`/miruro/native-stream`): after resolving `native.streamUrl`, checks if hostname is a blocked CDN (apex or subdomain). If so, returns `503 { cdnBlocked: true }` immediately without wrapping in `/api/anizone/hls`.

2. **Frontend** (`watch-anilist.tsx` `tryFetch`): parses JSON on non-2xx responses. When `cdnBlocked === true`, sets `miruroNativeLoading = false` immediately (no retry). This opens the SW iframe gate (`!miruroHlsUrl && !miruroNativeLoading && miruroIframeUrl && swReady`).

3. **Service Worker** (`sw-miruro.js`): intercepts fetches to these CDNs from the iframe context using the browser's IP, adds `Access-Control-Allow-Origin: *`.

**Why:** Without step 1, HLS.js retries the dead proxy URL 3–5× before declaring fatal. Without step 2, the frontend retried the sidecar 2× more on every 503.

**How to apply:** When adding new server-IP-blocked CDN hostnames, update `BLOCKED_CDN_SUFFIXES` in `miruro.ts` AND `CDN_SUFFIXES` in `sw-miruro.js` in lockstep. Both use the same apex+subdomain check: `host === sfx.slice(1) || host.endsWith(sfx)`.

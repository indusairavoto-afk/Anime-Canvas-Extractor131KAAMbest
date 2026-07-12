---
name: miruro.bz /api/secure/pipe blocks CF Worker + sidecar IPs (403)
description: miruro.bz's Cloudflare now 403-blocks /api/secure/pipe requests from both Cloudflare Worker IPs and Replit sidecar IPs (curl_cffi Chrome impersonation). Only real user browser IPs with cf_clearance can call pipe. Server-side HLS path is broken.
---

miruro.bz added CF protection to `/api/secure/pipe` that blocks:
- Replit server IPs (expected)
- Cloudflare Worker IPs (the relay at `workers.dev`) — CF to CF is NOT automatically allowed
- curl_cffi TLS Chrome impersonation from Replit sidecar
- Puppeteer+stealth headless browser (challenge doesn't resolve; cf_clearance not obtained)

As a result:
- `/api/miruro/native-stream` returns 503 (relay pipe → 403, sidecar → 403)
- `/api/miruro/pass/api/secure/pipe` returns 403 (sidecar pass-through blocked)
- `relay /pipe returned 403` in server logs is expected and not a secret mismatch

**Only viable path:** SW browser proxy (`/miruro-sw/*`). When the user's real browser IP loads miruro.bz via the SW, the SPA makes pipe calls from the browser's IP which may not be CF-blocked. Whether this works depends on the user's ISP/IP not being on miruro.bz's blocklist.

**How to apply:** When server logs show repeated 503 from native-stream + `Relay /pipe returned 403`, this is CF protecting the pipe endpoint — not a relay misconfiguration. The relay secret may still be correct. Focus on making the SW browser path work correctly (4xx detection, error overlays, race condition).

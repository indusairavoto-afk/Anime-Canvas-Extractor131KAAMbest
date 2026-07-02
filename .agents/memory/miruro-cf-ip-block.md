---
name: Miruro Cloudflare IP block
description: miruro.bz hard-blocks Replit server IPs (35.244.13.0 range) with CF 403; all server-side proxy fetches fail.
---

# Miruro Cloudflare IP Block

## The rule
`/api/miruro/stream` must do a reachability pre-check (HEAD to `/health` with 5s timeout) before returning an iframe URL. If the check returns 400+ (CF 403), respond with HTTP 503 JSON error so the frontend shows "Miruro Under Maintenance" and auto-switches servers.

`/api/miruro/proxy` must also check `upstream.status === 403 || 429` and body fingerprints (`cf-error-details`, `Cloudflare Ray ID`, `Sorry, you have been blocked`) before forwarding HTML — return 503 JSON if any match.

**Why:** As of 2026-07-02, Cloudflare on miruro.bz (and miruro.to, miruro.tv, miruro.fun, miruro.online) hard-blocks Replit server IPs with HTTP 403. CF returns `text/html; charset=UTF-8` with status 403, so the old code passed the content-type check and forwarded the CF block page to the browser, which showed as a black iframe — no error surfaced to the frontend.

**How to apply:** The `isMiruroReachable()` helper in `miruro.ts` does the HEAD check. Any time the proxy or stream handler is modified, ensure both checks remain: status-code check in proxy, and the pre-check call in stream.

## Debugging clue
If Miruro shows a black screen with no "Under Maintenance" overlay, the CF block is being silently forwarded. Check: does `/api/miruro/stream` return 503 or 200? If 200, the pre-check is missing or broken.

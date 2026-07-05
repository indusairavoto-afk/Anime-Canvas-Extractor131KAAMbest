---
name: Miruro SW bypass architecture
description: How the Service Worker CF bypass for miruro.bz is wired up end-to-end in watch-anilist.tsx
---

# Miruro Service Worker CF Bypass

## The approach
`/sw-miruro.js` (in `artifacts/anime-site/public/`) intercepts `/miruro-sw/*` fetch requests in the browser. The user's browser IP is not CF-blocked, unlike Replit's server IPs. The SW proxies miruro.bz HTML, strips X-Frame-Options/CSP, rewrites URLs, and injects a fetch interceptor.

## State machine (watch-anilist.tsx)
- `swReady` — SW is installed and active; MIRURO iframe only renders when true
- `swFailed` — SW timed out (5s) or registration failed; triggers fallback
- `miruroLegacyUrl` — server-side relay proxy URL (from `/api/miruro/stream`); used when SW fails and a relay is configured
- `miruroIframeUrl` — set to `/miruro-sw/watch/{id}/{slug}?ep={ep}` by stream endpoint
- `openMiruroDirectRef` — stable ref to `openMiruroDirect` useCallback; used in fallback effect to avoid stale closures

## Fallback chain (in order)
1. SW activates → iframe renders at `/miruro-sw/` URL
2. SW fails/times out AND relay configured → `miruroLegacyUrl` used directly
3. SW fails AND no relay → `openMiruroDirectRef.current()` → in-page proxy via `/api/miruro/direct-url`

## Key correctness rules
- `markReady()` calls both `setSwReady(true)` AND `setSwFailed(false)` — late activation clears the failure flag
- `miruroLegacyUrl` is reset to `null` before EACH stream request, then set to `data.legacyIframeUrl ?? null` — no stale bleed across episodes
- postMessage guard: requires `miruroIframeUrlRef.current !== null || miruroInPageUrlRef.current !== null` — prevents stale messages from poisoning state

## API changes
`/api/miruro/stream` now returns `{ swUrl, iframeUrl: swUrl, legacyIframeUrl? }`. `swUrl` is always present (constructed from params, no CF check needed). `legacyIframeUrl` only present when relay is configured and reachable.

**Why:** Replit server IPs are hard-blocked by CF on miruro.bz. SW approach routes through the user's browser IP which is never blocked.

## First-load race: iframe onError/onLoad cannot detect this failure
When the browser navigates to `/miruro-sw/*` before the SW is actually controlling that exact navigation (activation race on first load), the request bypasses the SW and hits raw network — Chrome renders its own "webpage might be temporarily down" error page inside the iframe. `<iframe onLoad>` still fires (the browser did technically load *a* document — its own error page), and `onError` does not fire for this case at all in Chrome. Both events are unreliable for detecting this specific failure mode.
**Fix:** positive proof-of-life instead of negative-error detection. The injected script (`buildInjectionScript` in sw-miruro.js) postMessages `miruro-sw-loaded` the instant real proxied content executes, and `miruro-sw-playing` when the video element actually starts playing. The parent arms a ~6s timer whenever it points the iframe at a fresh `/miruro-sw/` URL; if neither confirmation arrives in time, it assumes the race happened and falls back to `miruroLegacyUrl` or `swFailed`, same as the explicit failure paths.

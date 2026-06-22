---
name: megaplay.buzz stream detection
description: How to reliably detect broken GoGo/megaplay.buzz streams — bridge approach doesn't work, use server-side HLS probe
---

# megaplay.buzz broken stream detection

## Root cause
megaplay.buzz always returns HTTP 200 for player pages even when the video is DMCA'd/removed.
The "We're Sorry / Error Code: 410" is rendered CLIENT-SIDE by JWPlayer after it fetches the video
source URL and gets a 4xx back. Server-side HTML text matching (isCdnWorking) fails because those
markers never appear in the initial HTML.

## Why the postMessage bridge approach does NOT work for GoGo

The GoGo iframe loads megaplay.buzz **directly** (no proxy, no bridge script injected):
```ts
// watch-anilist.tsx — GoGo iframe src:
if (cdnUrl) return cdnUrl; // direct megaplay.buzz URL, NOT /api/proxy?url=...
```

The VIDEO_CONTROL_BRIDGE script (proxy.ts) is only injected into pages fetched via
`/api/proxy?url=...`. Since GoGo bypasses the proxy (proxying megaplay.buzz breaks JWPlayer
due to CORS on XHR calls), `na_video_state` postMessages **never fire for GoGo**.

**Why:** The original memory note "megaplay.buzz must load directly in iframe (no proxy)" means
bridgeLive/bridgeLiveRef can never become true for GoGo. Using it for visibility control broke
working GoGo episodes (overlay never cleared, 2.5s timeout always fired → always auto-switched).

## Correct fix: server-side HLS probe (probeStreamUrl in gogo.ts)

1. Fetch the megaplay.buzz player page HTML from Node.js
2. Extract the JWPlayer/Playerjs `file:` source URL from the inline script using regex: `/[,{(\s]file\s*:\s*["']([^"']{10,})["']/i`
3. HEAD-probe that source URL
   - 200/206 → stream is alive → `streamOk: true`
   - 4xx → stream DMCA'd → `streamOk: false`
   - Parse failure / timeout → `streamOk: true` (fail-safe)
4. API returns `streamOk` alongside `cdnUrl` in both `/api/gogo/cdn-url` and `/api/gogo/resolve-slug`
5. Frontend: if `streamOk === false` → `setGogoStreamError(true)` before iframe loads
6. Auto-switch effect fires → "switching to X…" → switches to KOTO/ANIZONE/MIRURO

**Result:** Users never see the "We're Sorry" error page.

## Rendering for GoGo (correct state — no bridgeLive)
- Loading overlay: `!iframeLoaded && !gogoStreamError`
- Iframe opacity: `iframeLoaded` (same as CUSTOM)
- "Stream broken?" button: `iframeLoaded && !gogoStreamError`
- NO 2.5s bridge-timeout detection (removed — bridge never fires for GoGo)

## What bridgeLive/bridgeLiveRef IS still used for
- Tracking postMessage state for CUSTOM server (goes through proxy, bridge fires there)
- Video control commands (na_cmd) — still work for CUSTOM
- Not used for any GoGo rendering or detection

## isCdnWorking: removed
Replaced by probeStreamUrl — text matching failed because "We're Sorry" is always JS-rendered.

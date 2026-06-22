---
name: megaplay.buzz stream detection
description: How to detect broken GoGo/megaplay.buzz streams — server-side probe no longer works; use window.blur heuristic
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
Also, megaplay.buzz's `e1-player.min.js` and `jw_player.js` send **zero postMessages** to parent.

## Why server-side HLS probe (probeStreamUrl) no longer works

megaplay.buzz changed its player architecture. Previously the `file:` source URL appeared in
inline HTML script tags. Now the source is fetched **entirely via JS** inside `e1-player.min.js`
(173KB, obfuscated, no recognizable fetch/XHR/source patterns). The initial HTML is always a
~2627-byte JS shell with no video URL in it. The `file:` regex never matches → falls back to
`return true` (fail-safe) → `streamOk` is always true even for broken streams.

**Also confirmed:** megaplay.buzz `/domains?h=...` returns base64 JSON of allowed referrers (ad
management only). There is no accessible API on megaplay.buzz that reveals whether the video file
is available without browser session cookies. `data-fileversion` is `0` for both working and
broken streams — cannot be used to distinguish them.

## Current fix: window.blur heuristic (client-side, in watch-anilist.tsx)

When the user clicks **inside** a cross-origin iframe, `window.blur` fires in the parent frame.
This is a detectable signal even though we cannot read iframe content.

**Heuristic logic:**
- Working GoGo video: JWPlayer shows a large play button → user clicks it → `window.blur` fires
- Broken GoGo video: "We're Sorry!" error page → user does NOT click the player → no `window.blur`

**Implementation (watch-anilist.tsx):**
1. `gogoMaybeBroken: boolean` + `gogoMaybeCountdown: number | null` state
2. useEffect triggered by `iframeLoaded && server === "GOGO" && !gogoStreamError && cdnUrl`:
   - Listen for `window.blur`; if fired, set `interacted = true`
   - 10-second timeout: if `!interacted` → `setGogoMaybeBroken(true)`
3. Countdown effect: when `gogoMaybeBroken`, tick down from 7 → 0
4. At countdown = 0: auto-switch to best available server (KOTO → ANIZONE → MIRURO)
5. Overlay: shows "GoGo Stream Not Playing" + countdown + manual switch buttons + "Dismiss"

**False-positive risk:** Slow connections or users who don't click play within 10s. Mitigated by
the "Dismiss" button and the fact that most users click the large JWPlayer play button quickly.

**Why:** No server-side or postMessage-based detection is possible for megaplay.buzz 410 errors.
The `window.blur` approach is the only cross-origin detectable user-interaction signal.

## Rendering for GoGo (correct state — no bridgeLive)
- Loading overlay: `!iframeLoaded && !gogoStreamError`
- Iframe opacity: `iframeLoaded` (same as CUSTOM)
- "Stream broken?" button: `iframeLoaded && !gogoStreamError && !gogoMaybeBroken`
- Maybe-broken overlay: `gogoMaybeBroken && !gogoStreamError`
- Error overlay: `gogoStreamError`
- NO 2.5s bridge-timeout detection (removed — bridge never fires for GoGo)

## What bridgeLive/bridgeLiveRef IS still used for
- Tracking postMessage state for CUSTOM server (goes through proxy, bridge fires there)
- Video control commands (na_cmd) — still work for CUSTOM
- Not used for any GoGo rendering or detection

## isCdnWorking: removed
Replaced by probeStreamUrl (now also broken due to megaplay.buzz architecture change).
probeStreamUrl is still called but always returns streamOk=true (fail-safe) for megaplay.buzz.

---
name: megaplay.buzz bridge detection
description: How to detect broken GoGo/megaplay.buzz streams and the bridgeLive state pattern
---

# megaplay.buzz "We're Sorry" detection

## The problem
megaplay.buzz always returns HTTP 200 for player pages (`/stream/s-2/{episodeId}/{type}`) even when the video is gone (DMCA/410). The "We're Sorry / Error Code: 410" is rendered CLIENT-SIDE by JWPlayer after it fetches the video source URL and gets 410. Server-side fetch cannot detect this.

**Why:** The HTML contains only JWPlayer initialization with `base_url: 'https://megaplay.buzz/'` — the actual video file URL is fetched dynamically by `client.js?v=3.0`.

## The fix: bridgeLive state pattern
- `bridgeLiveRef` (ref) + `bridgeLive` (state) — both track whether the GoGo postMessage bridge has fired
- Working streams fire postMessage within 1-2s
- After 2.5s with no postMessage → `gogoStreamError = true` → auto-switch to KOTO→ANIZONE→MIRURO after 0.6s
- The GoGo iframe has `opacity: bridgeLive ? 1 : 0` so users NEVER see the error page
- Loading overlay stays visible until `bridgeLive || gogoStreamError`
- Error overlay: `server === "GOGO" && gogoStreamError` (no `iframeLoaded` requirement)

## Reset locations
Reset BOTH `bridgeLiveRef.current = false` AND `setBridgeLive(false)` everywhere:
- Episode/server change effect cleanup
- Race `tryWin` helper
- Auto-switch timer callback
- All manual server-switch button handlers (Retry GoGo, AniKoto, AniZone, Miruro, GOGO server tab)

## isCdnWorking is not reliable
Removed from `probeCdnUrl` — megaplay.buzz always returns 200 HTML regardless of video availability.

---
name: Koto player fallback
description: KOTO player fallback chain, proxy inject strategy for vidtube.site vs megaplay.buzz
---

Koto API (`/api/koto/stream`) returns two fields: `hlsUrl` (direct HLS stream) and `url` (player page URL, often a vidtube.site URL).

**Rule:** Show the HLS player when `kotoHlsUrl` is set; fall back to a proxied iframe (`/api/proxy?url=kotoPlayerUrl&hideChrome=1`) when only `kotoPlayerUrl` is set; show the loading/error overlay only when BOTH are null.

**Why:** The original code had the overlay condition as `!kotoHlsUrl`, which showed "Episode not available on AniKoto" even when a `kotoPlayerUrl` was found.

**How to apply:** Three branches in the KOTO render section of `watch-anilist.tsx`:
1. `server === "KOTO" && kotoHlsUrl` → `<HlsPlayer>`
2. `server === "KOTO" && kotoPlayerUrl && !kotoHlsUrl` → proxied `<iframe>`
3. `server === "KOTO" && !kotoHlsUrl && !kotoPlayerUrl` → loading/error overlay

---

## Proxy inject strategy for vidtube.site

**Critical:** megaplay.buzz has `access-control-allow-origin: *` — the browser can call it directly from any origin.

**Rule:** For vidtube.site pages, inject `VIDTUBE_INJECT` (routes vidtube.site calls through proxy, passes megaplay.buzz calls through unchanged). Do NOT inject `MEGAPLAY_INJECT` for vidtube.site pages.

**Why:** MEGAPLAY_INJECT intercepts ALL relative URL calls and resolves them against `megaplay.buzz`. vidtube.site's own player scripts (e1-player.min.js, client.js) make relative calls to vidtube.site API endpoints. MEGAPLAY_INJECT incorrectly routes those to megaplay.buzz, breaking source fetching. Since megaplay.buzz has CORS *, the browser can call it directly — no proxy needed for megaplay calls from vidtube.site pages.

**How to apply:** In `proxy.ts`, the inject conditions are:
- `targetUrl.hostname.includes("vidtube")` → inject `VIDTUBE_INJECT`
- else if `targetUrl.hostname.includes("megaplay") || html.includes("megaplay.buzz")` → inject `MEGAPLAY_INJECT`

These are mutually exclusive (vidtube check first).

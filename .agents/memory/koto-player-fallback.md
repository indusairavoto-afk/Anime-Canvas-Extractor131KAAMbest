---
name: Koto player fallback
description: Two-tier Koto player: HLS preferred, iframe fallback when only playerUrl exists
---

Koto API (`/api/koto/stream`) returns two fields: `hlsUrl` (direct HLS stream) and `url` (player page URL).

**Rule:** Show the HLS player when `kotoHlsUrl` is set; fall back to a proxied iframe (`/api/proxy?url=kotoPlayerUrl&hideChrome=1`) when only `kotoPlayerUrl` is set; show the loading/error overlay only when BOTH are null.

**Why:** The original code had the overlay condition as `!kotoHlsUrl`, which showed "Episode not available on AniKoto" even when a `kotoPlayerUrl` was found. The fix changed the condition to `!kotoHlsUrl && !kotoPlayerUrl`.

**How to apply:** Three branches in the KOTO render section of `watch-anilist.tsx`:
1. `server === "KOTO" && kotoHlsUrl` → `<HlsPlayer>`
2. `server === "KOTO" && kotoPlayerUrl && !kotoHlsUrl` → proxied `<iframe>`
3. `server === "KOTO" && !kotoHlsUrl && !kotoPlayerUrl` → loading/error overlay

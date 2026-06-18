---
name: AniZone ASS subtitle conversion
description: AniZone serves .ass subtitle files; the browser's <track> element cannot load them; the API converts them to VTT on the fly.
---

## Rule
Never pass raw .ass URLs to the frontend `<track>` element. Always proxy through `/api/anizone/sub-vtt?u=<base64url>`.

## Why
AniZone CDN serves SubStation Alpha (.ass) subtitle files. Browsers only support WebVTT for the `<track>` element. Passing .ass directly results in a silent no-subtitle state.

## How to apply
- `assToVtt()` function in `artifacts/api-server/src/routes/anizone.ts` converts .ass → VTT.
- `subVttUrl(src)` wraps a subtitle URL into the proxy endpoint.
- `/api/anizone/stream` converts all subtitle src URLs via `subVttUrl()` before returning JSON.
- `/api/anizone/sub-vtt?u=<base64url>` endpoint fetches the upstream file and converts on the fly.
- The AI translate endpoint at `/api/translate-subtitle` receives VTT (via vttUrl param) and works correctly with the proxy URLs.

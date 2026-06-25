---
name: AnimeonSen Cloudflare bypass — token relay approach
description: Working bypass for the CF iframe block + server IP block; server derives JWT, browser makes API call.
---

## Rule

`api.animeonsen.xyz` is hard IP-blocked from Replit servers even with auth headers (confirmed 403 from curl).
`www.animeonsen.xyz` is NOT blocked — page fetches work fine and return `ao.session` cookie freely.

## Working Bypass: Token Relay

**Key insight:** Server CAN get `ao.session` from www (not blocked), and CAN derive the Bearer token. But
the SERVER cannot call api.animeonsen.xyz (IP blocked). The BROWSER can call it fine.

**Flow:**
1. Browser calls `/api/animeonsen/token?contentId=...` (our server).
2. Server fetches `www.animeonsen.xyz/watch/{contentId}?episode=1` → gets `ao.session` cookie.
3. Server derives Bearer: `base64_decode(ao.session).chars.map(c => charCode+1).join("")` → valid JWT.
4. Server returns `{ bearerToken }` to browser.
5. Browser calls `api.animeonsen.xyz/v4/content/{id}/video/{ep}` with `Authorization: Bearer {token}`.
6. Response contains HLS URL at `data.uri.streaming.hls` (also check `uri.hls`, `hls`, `stream.hls`).
7. HLS URL fed into native HLS player — no iframe, no CF popup.

**Why it works:** `www.animeonsen.xyz` serves the page (and cookie) freely from any IP. Token derivation
is reversible since watch.js obfuscates by shifting chars -1 then base64. api.animeonsen.xyz checks
the JWT auth rather than IP when the request comes from a real browser.

## Cookie Extraction Order (robustness in Node 20)

1. `Headers.getSetCookie()` — one string per Set-Cookie, no comma-splitting ambiguity
2. `headers.get('set-cookie')` split on `/,(?=[^;]*=)/` — comma-joined fallback
3. HTML regex `/ao\.session['"]\s*[,=:]\s*['"]([A-Za-z0-9+/=]+)['"]/` — inline script fallback

## Frontend Architecture

- `tryTokenExtract(contentId, ep)` — `useCallback` at component level; calls `/api/animeonsen/token` then browser API call.
- `tryBrowserExtract(contentId, ep)` — `useCallback`; browser direct with `credentials: "include"` (own CF cookies).
- `extractHls(contentId, ep)` — inner helper in main useEffect: `tryTokenExtract → tryBrowserExtract`.
- `aoHlsRetry` state — incremented when popup closes; separate `useEffect` retries extraction.
- Popup `setTimeout` calls `setAoHlsRetry(c => c + 1)` after `setAoCfReady(true)` to retry with fresh CF cookies.

## API Endpoints

- `/api/animeonsen/token?contentId=` — returns `{ bearerToken }` (JWT derived from ao.session).
- `/api/animeonsen/video?contentId=&ep=` — kept for completeness but always 403 (server IP blocked by CF).
- `/api/animeonsen/stream?title=&romajiTitle=&ep=` — searches MeiliSearch, returns `{ iframeUrl, contentId }`.

## Fallback Chain

`tryTokenExtract` → `tryBrowserExtract` → iframe embed (CF popup button if blank) → popup retry with `aoHlsRetry`

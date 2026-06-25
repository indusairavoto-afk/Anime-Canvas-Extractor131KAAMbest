---
name: AnimeonSen Cloudflare IP block + ao.session bypass
description: How to get HLS streams from AnimeonSen server-side despite api.animeonsen.xyz being CF-blocked; the ao.session cookie bypass.
---

## Rule

`api.animeonsen.xyz` was previously considered hard-blocked from Replit IPs. A server-side bypass now exists via the `ao.session` cookie auth scheme used by `watch.js`.

## ao.session Bearer Token Bypass

`watch.js` decodes `L("QXV0aG9yaXphdGlvbixCZWFyZXIsYW8uc2Vzc2lvbg")` → `"Authorization,Bearer,ao.session"`:
reads the `ao.session` cookie, base64-decodes it, shifts each char code **+1**, and sends the result as a Bearer token.

**Server-side steps:**
1. `GET https://www.animeonsen.xyz/watch/${contentId}?episode=${ep}` — www is **not** CF-blocked from Replit; the response sets `ao.session` freely.
2. Extract `ao.session` from Set-Cookie (try `getSetCookie()` → `headers.get('set-cookie')` → HTML inline fallback in that order).
3. `Buffer.from(aoSession, "base64").toString("binary")` → shift each char +1 → `bearerToken`.
4. `GET https://api.animeonsen.xyz/v4/content/${contentId}/video/${ep}` with `Authorization: Bearer ${bearerToken}` + `Cookie: ao.session=${aoSession}`.
5. Response contains HLS URL at `data.uri.streaming.hls` (or `uri.hls`, `hls`, `stream.hls`).

**Why:** The obfuscation is in `watch.js` L() decode → `"Authorization,Bearer,ao.session"`. The cookie value is a -1 shifted, base64-encoded token; reversing gives the actual JWT.

**How to apply:** Backend endpoint `/api/animeonsen/video?contentId=...&ep=...` implements this. Frontend calls it as `tryServerExtract` first, falls back to `tryBrowserExtract` (user's browser with own CF cookies), then falls back to iframe embed.

## Architecture

- `/api/animeonsen/stream` — unchanged; searches MeiliSearch, returns `iframeUrl` + `contentId`.
- `/api/animeonsen/video` — new; ao.session bypass → returns `hlsUrl` for native HLS playback.
- Frontend `extractHls(contentId, ep)`: tries `/api/animeonsen/video` first → `tryBrowserExtract` fallback → iframe last resort.
- All `extractHls(...).then(...)` calls include `if (!cancelled && hls)` guards to prevent stale episode state.

## Cookie Extraction Order (robustness)

1. `Headers.getSetCookie()` (Node 18+ native fetch) — one string per Set-Cookie header
2. `headers.get('set-cookie')` split on `,(?=[^;]*=)` — handles comma-joined multi-cookie strings
3. HTML regex: `/ao\.session['"]\s*[,=:]\s*['"]([A-Za-z0-9+/=]+)['"]/` — inline script fallback

---
name: Koto player fallback
description: KOTO player fallback chain and vidtube.site embed strategy
---

Koto API (`/api/koto/stream`) returns two fields: `hlsUrl` (direct HLS stream) and `url` (player page URL, often a vidtube.site URL).

**Rule:** Show the HLS player when `kotoHlsUrl` is set; fall back to an iframe when only `kotoPlayerUrl` is set; show the loading/error overlay only when BOTH are null.

**How to apply:** Three branches in the KOTO render section of `watch-anilist.tsx`:
1. `server === "KOTO" && kotoHlsUrl` → `<HlsPlayer>`
2. `server === "KOTO" && kotoPlayerUrl && !kotoHlsUrl` → iframe (vidtube.site = direct; others = proxied)
3. `server === "KOTO" && !kotoHlsUrl && !kotoPlayerUrl` → loading/error overlay

---

## vidtube.site must be embedded DIRECTLY (no proxy)

**Rule:** When `kotoPlayerUrl` is a `vidtube.site` URL, embed it as a direct `<iframe src={kotoPlayerUrl}>` — no `/api/proxy` wrapper.

**Why:** vidtube.site's player scripts (`e1-player.min.js`, obfuscated `client.js`) make API calls to `vidtube.site/api/source/ID` to fetch the video source. These calls require browser-side session cookies (set by Cloudflare and vidtube.site on page load). When proxied through our server, those cookies are absent → server gets `{"success":false,"error":"Episode not found"}` → player stalls forever on the loading spinner. vidtube.site stream pages have NO `X-Frame-Options` header, so direct embedding in an iframe works fine.

**How to apply:** In `watch-anilist.tsx` KOTO fallback iframe:
```jsx
src={/^https?:\/\/vidtube\.site/i.test(kotoPlayerUrl)
  ? kotoPlayerUrl
  : `/api/proxy?url=${encodeURIComponent(kotoPlayerUrl)}&hideChrome=1`}
```

---

## Proxy inject strategy (proxy.ts)

megaplay.buzz has `access-control-allow-origin: *` — browser calls it directly, no proxy needed.

For any vidtube.site page loaded through the proxy (e.g. future non-stream endpoints):
- Inject `VIDTUBE_INJECT` (routes vidtube.site calls through proxy, passes megaplay.buzz through unchanged)
- Do NOT inject `MEGAPLAY_INJECT` — it mis-routes vidtube.site relative URLs to megaplay.buzz

Conditions in `proxy.ts` are mutually exclusive (vidtube check first, then megaplay).

---
name: GoGo iframe origin rule
description: Why megaplay.buzz must be loaded directly in the iframe, not via our proxy
---

megaplay.buzz has no X-Frame-Options and uses `access-control-allow-origin: *`, so it can be embedded directly.

**Rule:** Always load the GoGo CDN URL (megaplay.buzz) directly as the iframe src — never proxy it.

**Why:** When proxied, the iframe origin becomes our Replit domain. The megaplay.buzz player JS (`e1-player.min.js`) makes API calls to megaplay.buzz to fetch the video source. These calls require session cookies (`GL_UI4`, `GL_GI10`) set by megaplay.buzz. Cross-origin requests don't send cookies unless the server uses `credentials: include` + a non-wildcard CORS policy — megaplay uses `*`, so cookies are never sent. The API calls fail silently and the player never loads (blank white screen).

**How to apply:** In `watch-anilist.tsx`, the GOGO iframe src should be `cdnUrl` directly, not `/api/proxy?url=...`.

**Note:** A 410 error from the player means that specific video was DMCA'd — not a code issue.

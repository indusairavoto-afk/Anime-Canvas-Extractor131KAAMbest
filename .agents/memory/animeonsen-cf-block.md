---
name: AnimeonSen Cloudflare IP block
description: api.animeonsen.xyz hard-blocks Replit's server IP; iframe is the only viable embed approach.
---

## Rule

`api.animeonsen.xyz` returns "Sorry, you have been blocked" (Cloudflare hard block) for ALL requests from Replit's server IP — including headless Chromium (playwright-core, CloakBrowser). Server-side stream URL extraction is not possible.

**Why:** Cloudflare blocks the Replit datacenter IP at the network level for api.animeonsen.xyz. This is not a bot-detection issue (stealth patches don't help). Even system Chromium launched from Replit gets blocked when navigating to api.animeonsen.xyz directly.

**How to apply:** The only viable approach is iframe embedding of `https://www.animeonsen.xyz/watch/${contentId}?episode=${ep}`. This runs entirely in the user's browser where:
- Their home/work IP is not blocked
- Cloudflare JS challenges pass automatically (real browser)
- No login required — video plays publicly
- Player JS calls api.animeonsen.xyz from within the iframe's www.animeonsen.xyz context (user's IP)

**Architecture:**
- Backend `/api/animeonsen/stream` searches MeiliSearch at `search.animeonsen.xyz` (not CF-blocked) to find the `content_id`
- Frontend sets `animeonsenIframeUrl = https://www.animeonsen.xyz/watch/${contentId}?episode=${ep}` and shows it as the primary player
- No server-side stream endpoint needed; `animeonsenStreamUrl` is always null; `animeonsenIframeUrl` is always the display path

**If blank overlay:** Shows "Open AnimeonSen ↗" link — clicking it opens animeonsen.xyz in a new tab, solving any first-visit CF cookie issues for api.animeonsen.xyz subdomain.

**www.animeonsen.xyz** DOES allow iframe embedding (no X-Frame-Options, no frame-ancestors CSP).

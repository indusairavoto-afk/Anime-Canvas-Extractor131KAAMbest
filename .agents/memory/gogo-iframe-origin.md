---
name: GoGo iframe origin rule
description: Why megaplay.buzz must be loaded directly in the iframe, and the streaming.php double-nest failure
---

**Pipeline:** `gogoanimes.cv/{slug}-episode-{ep}/` → extract `data-video` attr → get `gogoanime.com.by/streaming.php?ep=...&type=sub` → `extractInnerPlayerUrl` fetches streaming.php → extracts `megaplay.buzz/stream/s-2/{id}/sub` → return as cdnUrl → frontend loads megaplay.buzz directly in iframe.

**Rule:** Always load the megaplay.buzz CDN URL directly as the iframe src — never streaming.php, and never via our proxy.

**Why not streaming.php directly:** Attempting to load `gogoanime.com.by/streaming.php` directly as the iframe URL creates a double-nested iframe (our iframe → streaming.php → megaplay.buzz iframe). In this context, megaplay.buzz's JW Player fires error 102630 silently and shows a black screen — no player, no error message. Users have no idea what's wrong. Loading megaplay.buzz directly at least shows "We're Sorry!" when content is DMCA'd.

**Why no proxy:** The embedded player JS makes API calls using session cookies. Cross-origin proxy requests don't forward cookies (megaplay.buzz uses `access-control-allow-origin: *` which disqualifies credentialed requests), so the video source calls fail silently → blank player.

**DMCA 410 note:** When megaplay.buzz 410s an episode, the error is JS-rendered ("We're Sorry!" appears inside the iframe). It cannot be detected server-side — the static HTML is a valid player page (HTTP 200). There is no API on megaplay.buzz that confirms file availability without browser cookies/session. The user should switch to KOTO, ANIZONE, or MIRURO for that episode. This is a content-availability limitation, not a code bug.

**How to apply:** In `watch-anilist.tsx`, the GOGO iframe src must be `cdnUrl` (megaplay.buzz URL) directly. In `probeCdnUrl`, call `extractInnerPlayerUrl(streamingUrl)` to get the inner megaplay.buzz URL, then return that as cdnUrl.

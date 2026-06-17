---
name: Miruro X-Frame-Options block
description: miruro.to blocks all iframe embedding; miruro.ts must verify embeddability before advertising the URL
---

**Rule:** The `/api/miruro/stream` route must do a HEAD check on the constructed iframe URL before returning it. If the response includes `X-Frame-Options: SAMEORIGIN` or `DENY`, return 503 so the race marks MIRURO as failed and auto-selection skips it.

**Why:** miruro.to has `X-Frame-Options: SAMEORIGIN` sitewide (every path, including watch pages). If miruro.ts simply constructs the URL with string manipulation (no HTTP request), it returns in ~1ms and wins the race. The frontend then tries to embed it and gets blocked — showing either a blank frame or a broken-page icon. Users have no idea why the player is empty.

**Previous broken approach:** Constructing `https://www.miruro.to/watch/{id}/{slug}?ep={ep}` without verification. This always won the race but was always broken.

**Current approach:** HEAD-check the URL with `redirect: "follow"`. Check `x-frame-options` header. Return 503 if SAMEORIGIN/DENY. This adds latency (~300ms) but miruro.to always returns SAMEORIGIN, so MIRURO always fails the race and KOTO/ANIZONE/GOGO are chosen instead.

**Future note:** If miruro.to ever removes X-Frame-Options, MIRURO will automatically start working again (the HEAD check will pass). The old `api.miruro.tv` (which returned HLS streams directly) is permanently dead as of 2026.

**How to apply:** In `miruro.ts`, always perform the HEAD check. Do not remove it for "performance" — the whole point is to detect the SAMEORIGIN block before the frontend wastes a race slot.

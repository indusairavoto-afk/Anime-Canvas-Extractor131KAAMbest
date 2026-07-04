---
name: Miruro SW CORS failure fix
description: Why the SW showed "Server IP Blocked" incorrectly and how it was fixed
---

## The bug
The SW's `handleProxy` makes a cross-origin `fetch()` (mode='cors' by default) to miruro.bz.
When miruro.bz doesn't return CORS headers for the app's origin, the browser throws `TypeError: Failed to fetch`.
The catch block was calling `cfBlockResponse()` → sent `miruro-proxy-error` postMessage → parent showed "Server IP Blocked" even though the user's browser IP was NOT blocked.

## The fix (sw-miruro.js)
- In the `catch` block: `TypeError` → `swFailedResponse()` (sends `{type:'miruro-sw-failed'}`)
- Non-TypeError errors still go to `cfBlockResponse()`
- Tightened CF hard-block detection: removed `html.includes('Cloudflare Ray ID')` check (false-positive prone, can appear in analytics scripts on normal pages). Kept only `cf-error-details` and `Sorry, you have been blocked`.

## The fix (watch-anilist.tsx)
Added handler for `miruro-sw-failed` postMessage: when received with `server === "MIRURO"` and `miruroIframeUrlRef.current?.startsWith("/miruro-sw/")`, sets `swFailed=true`.
This triggers the existing swFailed fallback effect → relay URL (if MIRURO_PROXY_URL configured) or `openMiruroDirect`.

**Why:** CORS failure is a SW limitation (can't proxy cross-origin), not a CF IP block of the user's browser. These are fundamentally different failure modes.

## Known limitation
`swFailed` is sticky for the session — no reset on transient failures. Proposed as follow-up: reset on episode/server switch so SW gets another chance.

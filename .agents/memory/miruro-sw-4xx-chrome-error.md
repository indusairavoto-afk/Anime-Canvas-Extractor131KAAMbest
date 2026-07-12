---
name: Miruro SW passes 4xx to iframe — Chrome shows native error page
description: When miruro.bz returns 4xx (JSON or empty body) to the SW, passing it through causes Chrome's "webpage might be temporarily down" native error in the iframe — not a React component. SW must intercept all 4xx/5xx and return swFailedResponse instead.
---

Chrome renders its own native error page inside an iframe for any 4xx/5xx HTTP response that reaches the iframe without being caught — even from a same-origin URL. If the SW intercepts `/miruro-sw/watch/...`, fetches miruro.bz, gets a 404/403 JSON response, and passes `new Response(upstream.body, { status: 404 })` through, the iframe shows Chrome's error instead of the swFailedResponse overlay.

**Root bugs fixed:**
1. `new Uint8Array(buffer, 0, 128)` throws `RangeError` when `buffer.byteLength < 128` (e.g. `{"error":"Not found"}` is only 21 bytes). The body-peek try-catch hid the error but left `bodySnippet = ''`, so JSON detection never fired.
2. The code only checked body content for JSON errors; it never checked the HTTP status code. A 404 response with JSON body passed through as-is → Chrome error page.

**Fix:** In `sw-miruro.js` non-HTML branch, check `upstream.status >= 400` first and return `swFailedResponse` + notify parent via `clients.matchAll` postMessage immediately. Only peek the body (with `Math.min(128, ab.byteLength)`) for 2xx responses with suspicious content-type.

**Why:** `swFailedResponse` returns a 200 HTML page with a postMessage script, so Chrome renders it cleanly. Any non-200 response in the iframe causes Chrome's native error page, which has no postMessage script, so the parent never gets `miruro-sw-failed` and the overlay never appears.

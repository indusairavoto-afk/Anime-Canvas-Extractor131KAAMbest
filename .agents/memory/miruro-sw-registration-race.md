---
name: Miruro SW registration race — controllerchange vs statechange
description: markReady must fire on navigator.serviceWorker.controller check or controllerchange, NOT on statechange→"activated". Firing on "activated" sets swReady before the SW is controlling the page, causing the iframe to navigate before the SW can intercept.
---

The old registration code called `markReady()` when `worker.state === "activated"` (via statechange listener) in addition to `controllerchange`. `activated` fires BEFORE `clients.claim()` completes. So `swReady = true` was set while `navigator.serviceWorker.controller` was still null. The iframe rendered, navigated to `/miruro-sw/watch/...`, the SW didn't intercept (not controlling yet), Vite served `index.html`, React rendered with no route match — Chrome showed its native error page.

**Fix:** Check `navigator.serviceWorker.controller` directly at registration time. If it's truthy, markReady immediately (SW is already controlling). Otherwise, listen ONLY for `controllerchange` (fires after `clients.claim()` — authoritative that SW controls the page). Remove the `statechange` listener entirely.

```js
if (navigator.serviceWorker.controller) { markReady(); return; }
navigator.serviceWorker.addEventListener("controllerchange", markReady, { once: true });
if (navigator.serviceWorker.controller) { markReady(); } // concurrent check
```

**Also added:** `MiruroSwBridge` component at route `/miruro-sw/:rest*` in App.tsx. When the SW race still happens (iframe navigates to server before SW controls), React renders this component instead of the generic NotFound. Bridge waits for `controllerchange` then `window.location.reload()` so the SW intercepts the retry. Uses sessionStorage loop counter (max 2 reloads) to prevent infinite reload loop.

**Why:** `controllerchange` is the only event that guarantees `navigator.serviceWorker.controller !== null`. `reg.active` being truthy only means the SW is active in its registration — it may not be controlling the current page yet.

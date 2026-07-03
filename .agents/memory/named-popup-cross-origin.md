---
name: Named popup cross-origin document access
description: Reusing a window.open() popup by name across multiple clicks can crash if the window already navigated to a cross-origin page.
---

When a popup is opened repeatedly with the same window name (e.g. `window.open(url, "myPopup", features)`), subsequent calls return a reference to the *same* browser window rather than creating a new one — even after that window has navigated away to a different origin.

If code assumes the reused reference is still same-origin (e.g. writing a "Loading…" placeholder via `popup.document.write(...)`, or setting `popup.document.body.innerText` for an error state), it will throw:

`Failed to read a named property 'document' from 'Window': Blocked a frame with origin '...' from accessing a cross-origin frame.`

This happens because on a second click the named window may still hold the previous cross-origin page (e.g. a third-party streaming site) from the prior navigation, and same-origin policy blocks any `document` access on it.

**Why:** Only `location`, `close`, `closed`, `focus`, `blur`, and a few geometry properties (`outerWidth/outerHeight` etc.) remain accessible cross-origin; `document` does not.

**How to apply:** Wrap every `popup.document.*` read/write in try/catch when the popup is a reused named window that may later navigate to a third-party (cross-origin) URL. Navigation itself (`popup.location.href = url`) is safe and doesn't require document access, so it can stay outside the guard.

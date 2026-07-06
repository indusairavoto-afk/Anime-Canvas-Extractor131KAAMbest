---
name: owocdn.top / uwucdn.top require Referer kwik.cx
description: The CDN returns 403 unless Referer is https://kwik.cx/ — using miruro.bz as referer causes hard 403.
---

`vault-NN.owocdn.top` and `uwucdn.top` CDN servers validate the `Referer` header:
- `Referer: https://kwik.cx/` → HTTP 200
- `Referer: https://www.miruro.bz/` → HTTP 403
- No referer → HTTP 403

The m3u8 uses AES-128 encryption; the `.key` file and `.jpg` segments all go to the same CDN and need the same referer.

**Why:** The kiwi provider sources from kwik.cx embeds. kwik.cx sets its own origin as referer when the player loads CDN resources. Miruro.bz is only the playlist page, not the embed host.

**How to apply:** `handleCdnProxy` in `sw-miruro.js` must send `Referer: https://kwik.cx/` (not `MIRURO_ORIGIN`). This is hardcoded because all owocdn/uwucdn traffic comes from kiwi→kwik.cx.

---
name: Miruro Cloudflare IP block
description: miruro.bz hard-blocks Replit server IPs (35.244.13.0 range) with CF 403; all server-side proxy fetches fail.
---

# Miruro Cloudflare IP Block

## The rule
`/api/miruro/stream` must do a reachability pre-check (HEAD to `/health` with 5s timeout) before returning an iframe URL. If the check returns 400+ (CF 403), respond with HTTP 503 JSON error so the frontend shows "Miruro Under Maintenance" and auto-switches servers.

`/api/miruro/proxy` must also check `upstream.status === 403 || 429` and body fingerprints (`cf-error-details`, `Cloudflare Ray ID`, `Sorry, you have been blocked`) before forwarding HTML — return 503 JSON if any match.

**Why:** As of 2026-07-02, Cloudflare on miruro.bz (and miruro.to, miruro.tv, miruro.fun, miruro.online) hard-blocks Replit server IPs with HTTP 403. CF returns `text/html; charset=UTF-8` with status 403, so the old code passed the content-type check and forwarded the CF block page to the browser, which showed as a black iframe — no error surfaced to the frontend.

**How to apply:** The `isMiruroReachable()` helper in `miruro.ts` does the HEAD check. Any time the proxy or stream handler is modified, ensure both checks remain: status-code check in proxy, and the pre-check call in stream.

## Debugging clue
If Miruro shows a black screen with no "Under Maintenance" overlay, the CF block is being silently forwarded. Check: does `/api/miruro/stream` return 503 or 200? If 200, the pre-check is missing or broken.

## CloakBrowser stealth-solve does NOT bypass this (confirmed 2026-07-02)
Even with a stealth browser (CloakBrowser) launched server-side to solve the challenge, `https://www.miruro.bz/health` shows a persistent Cloudflare Turnstile "Just a moment... / Performing security verification" managed challenge that **never clears** from Replit's outbound IP (`cf_clearance` cookie never appears, even after 30s+). No hard-block phrase is shown, so it just hangs on the interactive challenge indefinitely — this is an IP/ASN reputation block, not a bot-fingerprint issue, so no amount of stealth-browser tuning fixes it. Mirrors the `api.animeonsen.xyz` block (see `animeonsen-cf-block.md`). Do not re-attempt "solving" this from the Replit workspace — the existing 503 + auto-switch-to-other-servers fallback is the correct, final behavior. A real fix would require running the solve step from a non-Replit-IP host (e.g. Render) and relaying the session back, same pattern as the AnimeonSen token relay.

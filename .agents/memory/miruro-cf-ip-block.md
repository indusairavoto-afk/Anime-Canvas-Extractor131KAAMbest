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
Even with a stealth browser (CloakBrowser) launched server-side to solve the challenge, `https://www.miruro.bz/health` shows a persistent Cloudflare Turnstile "Just a moment... / Performing security verification" managed challenge that **never clears** from Replit's outbound IP (`cf_clearance` cookie never appears, even after 30s+). No hard-block phrase is shown, so it just hangs on the interactive challenge indefinitely — this is an IP/ASN reputation block, not a bot-fingerprint issue, so no amount of stealth-browser tuning fixes it. Mirrors the `api.animeonsen.xyz` block (see `animeonsen-cf-block.md`).

## Fix implemented: standalone relay service (2026-07-02)
Built `@workspace/miruro-relay` (`artifacts/miruro-relay/`) — a tiny allow-listed forward-proxy meant to be deployed on a host whose IP Cloudflare doesn't flag (e.g. Render free tier). When the main api-server has `MIRURO_RELAY_URL` set, `miruroFetch()`/the ultracloud handler in `miruro.ts` route every outbound call through `relayFetch()` (`src/lib/miruro-relay.ts`) instead of using CloakBrowser — a plain fetch from the relay's IP succeeds immediately, no CF-solving needed. Without the env var set, the old CloakBrowser path remains as a fallback (works nowhere in practice, but doesn't break anything). `render.yaml` defines `miruro-relay` as a second free web service; `MIRURO_RELAY_URL` on the main service must be set manually post-deploy (sync: false) to the relay's public `https://...onrender.com` URL — Render blueprints have no built-in property to inject one service's own external URL into another's. The unconditional `warmCfSession()` call at module load in `miruro.ts` must also be gated behind `if (!isMiruroRelayConfigured())`, or it still runs (and fails) the CloakBrowser CF-solve on every server start even when a relay is configured.

## Render's shared IPs can also get flagged (confirmed 2026-07-03)
A freshly deployed Render free-tier relay instance was *also* served a Cloudflare managed challenge (403, `cf-mitigated: challenge`, "Just a moment...") when hitting `www.miruro.bz` directly — not a hard IP-range block like Replit's, but Cloudflare's bot-management already flags/challenges this shared Render IP pool for miruro.bz's zone specifically. `pro.ultracloud.cc` (the actual video CDN host, also relay-allow-listed) was NOT challenged from the same Render IP (plain 404 for a bad path) — only the miruro.bz zone's WAF is this aggressive.

**Takeaway:** a plain pass-through relay on a common shared-hosting IP (Render, likely also Railway/Fly/Heroku free tiers) is not a guaranteed fix for miruro.bz specifically — Cloudflare bot-management can flag entire hosting-provider IP ranges over time regardless of the specific account. A residential/rotating-IP proxy service would be a more durable fix; a second cloud host is a coin flip that can stop working again later.

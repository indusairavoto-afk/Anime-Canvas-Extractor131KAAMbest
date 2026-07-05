---
name: Miruro relay secret must match Cloudflare Worker
description: MIRURO_RELAY_SECRET (server) and RELAY_SECRET (Cloudflare Worker) are two separately-managed values that must be identical strings, or the relay silently 401s and playback falls back to slower/broken paths.
---

The Cloudflare Worker at `workers/miruro-relay` checks an `x-relay-secret` header against its own `RELAY_SECRET` (set via `wrangler secret put`). The API server sends this header using its own `MIRURO_RELAY_SECRET` env var. These are two independent secret stores — Cloudflare's and Replit's — with no automatic sync.

**Why:** If a user deploys/redeploys the Worker with a new `RELAY_SECRET`, the Replit-side `MIRURO_RELAY_SECRET` becomes stale and every relay call gets a 401, which `miruroFetch()` silently swallows and falls back to the (often broken/CF-blocked) direct/CF-session path — the failure mode looks like generic "Miruro not working," not an auth error, unless you check server logs for `[miruro] Relay returned 401`.

**How to apply:** When a user reports pasting a new relay secret/URL, or Miruro playback breaks after they mention touching the Worker, verify with `curl <relay>/relay?url=...` (expect 401 without header) and check `[miruro] Relay returned 401` in server logs. Update `MIRURO_RELAY_SECRET` via `requestEnvVar` (never set secrets directly, even if the user pastes the raw value in chat) to match, then restart the API server workflow.

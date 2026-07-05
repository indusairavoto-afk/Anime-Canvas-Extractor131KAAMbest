---
name: Miruro sidecar origin mismatch + sources-resolution outage
description: Python sidecar defaulted to miruro.tv while relay/CF fix targets miruro.bz; "sources" pipe calls can 502 uniformly across all providers even when "episodes" pipe calls succeed.
---

## Origin mismatch
`artifacts/miruro-sidecar/main.py` defaults `MIRURO_SIDECAR_ORIGIN` to `https://www.miruro.tv`, but the working relay/CF-bypass setup elsewhere in the codebase (see `miruro-domain.md`) targets `www.miruro.bz`. If a relay is configured but the sidecar still points at `.tv`, set the `MIRURO_SIDECAR_ORIGIN` env var explicitly to `https://www.miruro.bz` to match.

**Why:** the two domains are different backends; pipe requests to the wrong one may 404/mismatch even if the relay itself is healthy.

## "sources" pipe calls can fail while "episodes" succeed
The Miruro pipe backend (`/api/secure/pipe`) can return a custom branded "502 upstream unreachable / service disruption" HTML page (not a Cloudflare challenge, not our relay failing) specifically for `path=sources` requests, uniformly across every provider (kiwi, arc, zoro, hop, bonk, ally, pewe, moo, bee), while `path=episodes` succeeds normally and fast (<1s, not a timeout).

**Why:** this looks like a real (possibly temporary) outage/lockdown on Miruro's own video-source-resolution microservice, separate from the Cloudflare IP-block problem the relay solves. Confirmed by testing the relay's `/pipe` endpoint directly with curl/httpx outside of app code — identical failure, so it isn't a bug in our relay or sidecar code.

**How to apply:** `fetchMiruroNativeStream` (in `artifacts/api-server/src/lib/miruro-sidecar.ts`) now loops through every provider that has the target episode instead of only trying the first-priority one, in case only some providers are affected. If ALL providers fail this way again, treat it as an upstream Miruro outage — the native-HLS path is expected to fail open (403/503) and the UI already falls back silently to the iframe/SW path, which is the primary supported mechanism.

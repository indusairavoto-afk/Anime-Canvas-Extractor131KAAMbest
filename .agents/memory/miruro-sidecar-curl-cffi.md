---
name: Miruro Python sidecar (curl_cffi TLS impersonation)
description: Native m3u8 resolution for Miruro via a Python FastAPI sidecar instead of Puppeteer; env quirks and response schema uncertainty.
---

A Python FastAPI sidecar (`artifacts/miruro-sidecar/`, port 8090, localhost-only)
resolves direct m3u8 streams from miruro's `/api/secure/pipe` backend using
`curl_cffi` (Chrome TLS fingerprint impersonation) instead of launching a
Puppeteer browser. The Node API server calls it from `GET /api/miruro/native-stream`
and prefers it over the existing iframe/SW bypass when it succeeds, falling back
silently to the iframe/SW path otherwise.

**Why:** The pipe's "secure" payloads are just base64+gzip(json) — no real
crypto — so the only actual barrier is Cloudflare's TLS/browser fingerprint
check, which curl_cffi defeats without a headless browser. This is lighter and
faster than the Puppeteer+stealth+CF-extension approach, and unlocks
multi-provider sources + intro/outro skip data as a bonus. Still requires a
non-datacenter egress IP (same `MIRURO_PROXY_URL` constraint as the existing
bypass) — without it, Cloudflare 403s the sidecar's requests just like it does
the direct server-side fetch.

**How to apply:**
- Uvicorn **must** run with `--loop asyncio`, not the default `uvloop`. Under
  uvloop, `curl_cffi.requests.AsyncSession` requests inside a live event loop
  silently kill the whole worker process with no traceback (health check
  still respond fine — it only crashes on real outbound requests). Confirmed
  by reproducing the exact same code as a standalone asyncio script (works
  fine) vs. inside FastAPI/uvicorn (dies) — isolate loop policy first if this
  ever regresses.
- `pyproject.toml` had `requires-python = ">=3.13"` from the initial project
  stub, but only Python 3.11 is installed via Nix — `uv sync` fails silently
  looking for a 3.13 interpreter until the constraint is loosened.
- The `/watch/{provider}/{anilistId}/{category}/{slug}` sources response
  schema was never actually observed (Cloudflare 403s every real request
  without a residential proxy) — extraction logic in
  `artifacts/api-server/src/lib/miruro-sidecar.ts` defensively probes several
  common key names (`url`/`file`/`sources[]`/`subtitles[]`/`intro`/`outro`).
  If `MIRURO_PROXY_URL` is ever set and native-stream still 502s with "No
  playable stream", inspect a live response and tighten the extractor.

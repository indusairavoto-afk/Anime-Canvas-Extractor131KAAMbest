---
name: Miruro x-obfuscated header
description: The pass-through proxy must forward the x-obfuscated response header from upstream or the SPA falls back to YouTube.
---

# Miruro x-obfuscated response header

## The rule
The `/api/miruro/pass/*` proxy must forward the `x-obfuscated` response header (and any other `x-*` metadata headers, excluding security ones) from the upstream miruro.bz response.

**Why:** The Miruro SPA's `makeSecureGet` method checks `response.headers.get('x-obfuscated')` to decide how to decrypt `/api/secure/pipe` responses. When the value is `"2"`, it XOR-decrypts the base64url-decoded response body using `VITE_PIPE_OBF_KEY` (from env2.js), then decompresses. If the header is missing, the SPA attempts to JSON-parse the raw encrypted bytes → parse error → all stream sources fail → falls back to `ally` provider (YouTube PV/trailer).

**How to apply:** In the pass-through handler (`router.all("/miruro/pass/*path")`), after setting Content-Type and Cache-Control, iterate upstream response headers and forward any `x-*` header except `x-frame-options`, `x-xss-protection`, `x-content-type-options`, `x-request-id`, `x-robots-tag`.

## Debugging clue
If Miruro iframe shows YouTube trailer/PV instead of the episode, and the Miruro UI (header, episode list, bookmark notice) loads correctly, this header is almost certainly missing from the proxy response.

## API notes
- `/api/episodes?anilistId=...` returns `{"error":"Gone"}` — plain API is disabled; only secure pipe works.
- `/health` returns `{"status":"ok","version":"1.10.5"}` — accessible server-side without Cloudflare blocking.
- `VITE_PIPE_OBF_KEY` in env2.js is the XOR key; env2.js must be inlined synchronously before module scripts.

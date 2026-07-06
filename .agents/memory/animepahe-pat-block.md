---
name: AnimePahe Cloudflare Private Access Token block
description: animepahe.pw (and .ru) cannot be bypassed by relay/TLS-impersonation/headless-browser — needs real device attestation.
---

`animepahe.pw` fronts every page (home, search API, play page) with a Cloudflare
**Private Access Token** challenge, not a plain Turnstile "Just a moment..."
page. Confirmed via network trace: the challenge JS requests a PAT from
`challenges.cloudflare.com/.../pat/...` which returns `401`, and the page
stays on "Performing security verification" indefinitely — it never resolves
because a scripted/headless browser has no genuine Apple/Google device
attestation to present (this is the same mechanism used by App Store/Play
Integrity anti-abuse, not a JS puzzle).

Tried and confirmed ineffective:
- Routing through a clean Cloudflare-edge relay (works for Miruro's plain IP
  block, does nothing here — the challenge is per-request/session, not IP).
- curl_cffi Chrome TLS impersonation (still gets the challenge page, 403).
- puppeteer-extra + stealth plugin + real Chromium, waiting 30s+ (challenge
  never completes, `cf_clearance` cookie never appears).

**Why:** PAT challenges are a hardware-attestation gate, categorically
different from Turnstile (a JS/interaction puzzle solvable by a real headless
browser) or a plain IP block (solvable by relay/TLS spoof). No amount of
stealth patching fixes this because the attestation itself is cryptographic
and hardware-backed.

**How to apply:** Don't attempt puppeteer/relay/TLS-impersonation bypasses for
animepahe.pw again — it's a dead end. Either drop AnimePahe as a source, pay
for a CAPTCHA/PAT-solving service with real device farms (2Captcha, CapSolver,
etc.), or rely on manually-refreshed `cf_clearance` cookies pasted in by a
human with a real browser (short-lived, not viable for unattended service).
`kwik.cx` itself (the video host AnimePahe embeds) is NOT behind Cloudflare —
if cookies are ever obtained by other means, the existing p,a,c,k unpack +
m3u8 extraction pipeline in `pahe.ts` is ready to use.

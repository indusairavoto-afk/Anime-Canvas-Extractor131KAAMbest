---
name: comix.to search API blocked
description: Why server-side manga search on comix.to is impossible and what the fallback strategy is.
---

## The rule
comix.to's search API (`/api/v1/manga?q=`) requires a token that cannot be obtained server-side. The `cfg` meta tag on every page holds the token in an encrypted binary format — it is NOT simple base64url or single-byte XOR. The decryption routine is in a minified JS bundle with no visible `atob`, `charCodeAt`, or `cfg` string literals in either the main or vendor bundles. No cookies are set by comix.to on server-side requests (Cloudflare blocks them).

Browse pages (`/browse?search=...`, `/hot`, `/new`, genre pages) always have `queries:{}` in their SSR `initial-data` regardless of query params or request headers (including `X-Inertia: true`). Only the home page (`/`) has SSR manga data — approximately 150 currently-trending HIDs, almost all manhwa/romance, never classic popular manga.

## The fallback strategy
When `/api/comix/find` returns `not_found`:
1. Show official STREAMING links from AniList `externalLinks` (MangaPlus, VIZ, etc.)
2. Show `https://comick.dev/comic/{slug}` — comick.dev is the same database as comix.to, uses slug-only URLs (no HID needed), constructed by normalizing the title to kebab-case
3. Keep "Search on comix.to" as last resort

**Why:** comick.dev uses the same underlying data but its URL format is `/comic/{slug}` with no HID prefix, making it constructable from any title without API access.

## What was tried and failed
- Bearer/Token/X-Token/X-Api-Key/X-Cfg headers with the cfg value → "Missing token."
- cfg as cookie or query param → "Missing token."
- Sitemap.xml/robots.txt → both 404
- Slug-only title URLs (`/title/chainsaw-man`) → 404
- comick.io/comick.fun API → server-side blocked (returns HTML or 403)
- MangaDex API → server-side blocked (returns HTML)
- comick.dev → server-side 403 (Cloudflare), but browser works
- Inertia.js JSON mode (`X-Inertia: true` + version) → still returns full HTML
- All browse/genre/type pages → 0 HIDs in SSR

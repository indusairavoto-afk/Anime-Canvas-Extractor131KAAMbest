---
name: MangaFire slug pattern and sitemap search
description: How to find the correct mangafire.to manga slug — the AJAX search is auth-gated; use the doubled-last-char pattern + sitemap XML search instead.
---

## Rule
MangaFire slugs always double the last character of the last word in the title slug:
- "chainsaw man" → `chainsaw-mann.0w5k`
- "one piece" → `one-piecee.dkw`
- "gun x clover" → `gun-x-cloverr.gl3`
- "darkness" suffix → `darknesss`

The full slug format is `{doubled-title-slug}.{3-6-char-alphanumeric-id}`.

## Why
AJAX search endpoint (`/ajax/manga/search`) returns 403 "Request is invalid" — it requires a Cloudflare Turnstile session token that cannot be obtained server-side. The filter page (`/filter?keyword=...`) renders results entirely client-side (no SSR data in HTML).

## How to find the slug
1. Apply `makeDoubledSlug()`: take the normal slug and append its last character.
2. Search `sitemap-list-1.xml` through `sitemap-list-54.xml` in parallel batches of 10.
3. Each sitemap is ~125KB and contains `<loc>https://mangafire.to/manga/{slug}</loc>` entries.
4. Match: `titlePart === doubledSlug || titlePart.startsWith(doubledSlug)` where `titlePart` is the slug before the last `.`.
5. The matching full slug (with ID) is the one to use in the iframe URL.

## Implementation
- `makeDoubledSlug(s)`: `makeSlug(s) + lastChar`
- `searchSitemap(idx, doubled)`: fetch one sitemap, regex-match `/manga/(slug)/`, compare title part
- `searchAllSitemaps(doubled)`: batch 10 at a time, return first hit

## Notes
- Chainsaw Man is in sitemap-list-9.xml
- One Piece is in sitemap-list-1.xml
- Sitemaps are NOT alphabetically sorted by title

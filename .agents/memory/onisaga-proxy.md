---
name: onisaga.com proxy
description: How onisaga.com is used as the primary manga reader proxy, its URL structure, and proxy implementation details.
---

## The rule
onisaga.com is the primary manga reader. It is a Laravel + Livewire SSR site, meaning pages render as real HTML server-side — no SPA blank-screen problem. URLs are slug-based with no HID prefix, so any manga title can be probed directly.

## URL structure
- Manga title page: `https://onisaga.com/manga/{slug}` (e.g., `/manga/chainsaw-man`)
- Chapter reader: `https://onisaga.com/read/{slug}/{db-id}` (e.g., `/read/chainsaw-man/1053486`)
- Chapter db-ids are NOT sequential chapter numbers; they are database IDs

## Find strategy
1. Normalize title to slug: lowercase, non-alphanumeric → `-`, trim `-`
2. Try slug variants: with/without leading articles, before colons
3. Fetch `https://onisaga.com/manga/{slug}` — if 200 AND HTML contains `/read/{slug}/`, it's a real manga page
4. Return `{ found: true, url: "/manga/{slug}" }`

## Proxy details
- `X-Frame-Options: SAMEORIGIN` → must be stripped by proxy (never forwarded)
- Sets `onisaga_session` cookie on every response → forwarded via Set-Cookie
- Uses Livewire for dynamic content → pass proxy must forward `X-CSRF-TOKEN` and `X-Livewire` headers
- Chapter images served from `https://onisaga.com/uploads/...` → rewritten through pass proxy
- Chapter pages use Alpine.js with `page.image_url` template syntax for lazy image loading
- `history.pushState` is intercepted and rewritten in the injected script (Livewire v3 navigation)

## Fallback chain
onisaga (primary) → comix.to (secondary, with `__comix__` URL prefix to distinguish) → AniList external links + comick.dev

**Why:** onisaga slug derivation covers virtually all manga titles without any API authentication.

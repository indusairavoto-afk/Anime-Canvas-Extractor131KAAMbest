---
name: comix.to browse SPA white screen fix
description: Why comix.to browse/search pages always show white screen in the proxy, and how the reader was fixed.
---

## The problem
comix.to is a custom SPA where browse/search pages are **fully client-side rendered** — the server always returns an empty HTML shell with `<div id="app-root"></div>` and `initial-data: { queries: {}, routes: [] }`. Search results are never embedded in SSR, regardless of session cookies, Accept headers, or X-Inertia headers.

**Why:** comix.to's TanStack Query cache (embedded in `initial-data`) is only pre-populated for **title pages** (`/title/{hid}-{slug}`). The SPA loads results client-side by calling its own backend API (auth via same-origin cookies), which fails in a proxy context.

## What DOES work
Title pages at `https://comix.to/title/{hid}-{slug}` have full SSR in `initial-data`:
- Full manga data including chapters, synopsis, links
- `links.al` = AniList URL (proves comix.to knows AniList IDs)
- The SPA renders correctly from SSR data without additional API calls

## The fix
1. **`GET /api/comix/find?title=`** — fetches comix.to home page SSR (has ~100 trending manga with HIDs and URLs), fuzzy-matches the title. Returns `{found,url,hid,title}`. Home page has daily trending manhwa/webtoons, NOT classic anime manga like Chainsaw Man.
2. **URL rewriting catch-all** — added `if (url.startsWith('/') && !url.startsWith('/api/comix/')) return PASS + url` so the SPA's TanStack Query refetches go through the proxy instead of our server.
3. **`ReaderModal` state machine** — on mount calls `/api/comix/find`, shows spinner while searching, loads title page if found, shows graceful "not found" UI with "Search on comix.to" external link button if not found.

## HID format
comix.to HIDs are base-36 IDs (e.g. `69l57` = Chainsaw Man). Cannot be derived from title — must be discovered from SSR data.

## Fuzzy match gotcha
Non-ASCII alt titles (Korean/Japanese) normalize to empty strings. `q.includes("")` always returns true → every manga matches. Fix: require both strings to be ≥2 chars, and for substring match require shorter string ≥5 chars.

**Why:** comix.to embeds Japanese/Korean altTitles for all manga.

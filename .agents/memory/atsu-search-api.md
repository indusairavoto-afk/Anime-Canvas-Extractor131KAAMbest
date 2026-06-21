---
name: atsu.moe search API
description: How atsu.moe's manga search works — proxied Typesense at a relative URL, no auth key needed.
---

## Rule
atsu.moe's Typesense search is proxied at a **relative path** on the site itself — no external host, no API key required:

```
GET https://atsu.moe/collections/manga/documents/search?q={title}&query_by=title,englishTitle,otherNames&per_page=5
```

Returns hits with `document.id` (the atsu.moe manga ID, e.g. `VRSVH` for Chainsaw Man).

**Why:** The JS bundle references `/collections/${n}/documents/search?${r}` as a relative URL — the Typesense instance is proxied server-side by Cloudflare, not exposed directly.

**How to apply:**
- Search by title to get `id`
- Fetch `https://atsu.moe/manga/{id}` SSR page, parse `window.mangaPage = {...};` from HTML
- The `mangaPage.chapters` array is newest-first; reverse for Ch.1-first display
- Reader URL: `https://atsu.moe/read/{mangaId}/{chapterId}`
- `anilistId` filter does NOT work in Typesense (not in schema); match by title instead
- Backend route uses `/atsu/find` (not `/api/atsu/find`) since Express mounts at `/api` prefix

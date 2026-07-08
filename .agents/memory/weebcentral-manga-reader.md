---
name: WeebCentral native manga reader
description: Primary manga source is server-side WeebCentral scraping rendered as native images, not an iframe of a third-party site.
---

The manga reader tries WeebCentral first (server-side scrape, no CORS issues since it's server-to-server), falling back to the existing atsu.moe iframe proxy only if WeebCentral has no match.

**Why:** iframing any third-party manga site (atsu.moe, voidstream.space, etc.) drags in their own UI chrome (comments, bottom tabs, bookmarks) that's hard to fully hide/reliably strip. Scraping WeebCentral server-side and rendering images directly in our own reader UI means we fully own the UI with zero third-party chrome, and CDN images (scans-hot.planeptune.us / hot.planeptune.us) load with no Referer or auth requirements.

**How to apply:** `GET /api/weebcentral/find?title=` returns `{found, seriesId, chapters:[{id,number,title,index}]}` (chapter 1 = index 0, ascending). `GET /api/weebcentral/pages?chapterId=` returns `{pages:[imageUrls]}` — render as a plain vertical `<img>` scroll, no headers/proxying needed. If `found:false` or the request errors, fall back to the atsu.moe find/proxy flow. Regex-based HTML parsing is used (no cheerio/jsdom).

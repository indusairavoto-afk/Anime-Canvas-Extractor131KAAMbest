---
name: atsu.moe reader bottom UI hidden via proxy
description: How the manga reader hides atsu.moe's own Comments/Chapters/Reading tabs, bookmark row, and comment section since they're loaded as a cross-origin iframe.
---

The manga ReaderModal (`manga-detail.tsx`) embeds `atsu.moe/read/{mangaId}/{chapterId}` directly. That page is cross-origin, so the parent app cannot reach into its DOM to hide unwanted chrome (its own Comments/Chapters/Reading tab bar, bookmark row, "login to comment" prompt) with normal CSS/JS.

**Fix:** the iframe now points at `/api/atsu/proxy?mangaId=...&chapterId=...` (same-origin, in `artifacts/api-server/src/routes/atsu.ts`), which server-side fetches the real atsu.moe HTML, inserts a `<base href="https://atsu.moe/">` tag (so all the page's relative asset/API URLs keep resolving against atsu.moe), and injects a `<script>` that finds the tab bar by text-content heuristics (an element whose own text is exactly "Comments" with an ancestor whose text also contains "Chapters" and "Reading"), then hides that tab bar plus every DOM sibling after it at each ancestor level up to `<body>` — since the comments panel/bookmark row aren't reliably nested inside the tab bar container itself. A "Manga Info / Next Chapter" row immediately preceding the tab bar is hidden too (it duplicates our own reader toolbar nav). Runs on load + via MutationObserver + a 30s interval poll, matching the existing text-heuristic hiding pattern used for Miruro's download button.

**Why:** atsu.moe is a client-hydrated SPA with no distinct CSS classes to target reliably (webpack/vite hashed classnames), so text-content matching + "hide everything after this point in the DOM" is the only robust cross-render-cycle approach without controlling their source.

**How to apply:** if atsu.moe changes their tab labels or DOM structure and the bottom UI reappears, re-inspect via `curl` on `/read/{mangaId}/{chapterId}` (it embeds `window.mangaPage` JSON) and adjust the text markers in `HIDE_BOTTOM_UI` in `atsu.ts`. The same "same-origin proxy + injected heuristic-based hide script" approach generalizes to any other cross-origin manga/anime reader embed that can't be modified directly.

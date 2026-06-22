---
name: AniZone cascade search + year boost
description: Long English anime titles return empty results from AniZone search; a cascade of progressively shorter queries is required; bestAutoSlug needs a seasonYear-based boost since AniZone uses (YYYY) suffixes. AniZone stores many anime under Japanese titles — single-result searches must auto-select unconditionally.
---

## Rule
`triggerAnizoneSearch` must cascade: try full title → alphanumeric-only → first 3 words → first-two-words-joined (for short prefixes like "Re" from "Re:Zero") → first word.

`bestAutoSlug` must accept `seasonYear` (number|null) and boost by +500 when the result title contains `(${seasonYear})`, penalise by -300 when it contains a different year.

**Single-result auto-select**: in `triggerAnizoneSearch`, when `results.length === 1`, skip `bestAutoSlug` and use `results[0].slug` directly. AniZone stores many shows under their Japanese title (e.g. "Daemons of the Shadow Realm" → "Yomi no Tsugai"), so word-overlap scoring always returns -999 and no slug gets set. A single returned result from a specific multi-word English query is almost certainly correct.

## Why
- AniZone's search returns empty for long English subtitles (e.g. "Re:Zero -Starting Life in Another World-").
- AniZone uses `(YYYY)` suffixes for multi-season shows instead of season ordinals ("Season 4", "4th Season").
- Scoring by word overlap alone gives every Re:Zero entry the same score; year-based boosting selects the right season.
- "Re:Zero" splits into "Re" + "Zero" when normalized by space — single-word fallback "Re" is too generic; joining gives "rezero" which AniZone's search handles correctly.
- AniZone stores many shows under Japanese titles, causing zero word overlap with English queries → -999 score → slug never set even when search finds the correct entry.

## How to apply
- In `triggerAnizoneSearch`: build `candidateQueries` array with deduped cascade; call `tryQuery(0)` recursively.
- Pass `anime?.seasonYear ?? null` as `seasonYear` to `bestAutoSlug`.
- In `bestAutoSlug`: check `r.title.toLowerCase().includes(`(${yearStr})`)` for boost; check `/\(\d{4}\)/.test(r.title)` for wrong-year penalty.
- When `results.length === 1`: `const slug = results.length === 1 ? results[0].slug : bestAutoSlug(...)`.

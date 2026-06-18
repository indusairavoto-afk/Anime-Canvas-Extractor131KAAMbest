---
name: AniZone cascade search + year boost
description: Long English anime titles return empty results from AniZone search; a cascade of progressively shorter queries is required; bestAutoSlug needs a seasonYear-based boost since AniZone uses (YYYY) suffixes.
---

## Rule
`triggerAnizoneSearch` must cascade: try full title → alphanumeric-only → first 3 words → first-two-words-joined (for short prefixes like "Re" from "Re:Zero") → first word.

`bestAutoSlug` must accept `seasonYear` (number|null) and boost by +500 when the result title contains `(${seasonYear})`, penalise by -300 when it contains a different year.

## Why
- AniZone's search returns empty for long English subtitles (e.g. "Re:Zero -Starting Life in Another World-").
- AniZone uses `(YYYY)` suffixes for multi-season shows instead of season ordinals ("Season 4", "4th Season").
- Scoring by word overlap alone gives every Re:Zero entry the same score; year-based boosting selects the right season.
- "Re:Zero" splits into "Re" + "Zero" when normalized by space — single-word fallback "Re" is too generic; joining gives "rezero" which AniZone's search handles correctly.

## How to apply
- In `triggerAnizoneSearch`: build `candidateQueries` array with deduped cascade; call `tryQuery(0)` recursively.
- Pass `anime?.seasonYear ?? null` as `seasonYear` to `bestAutoSlug`.
- In `bestAutoSlug`: check `r.title.toLowerCase().includes(`(${yearStr})`)` for boost; check `/\(\d{4}\)/.test(r.title)` for wrong-year penalty.

---
name: MIRURO overlay null crash
description: romajiTitle is undefined while anime data is loading; calling .toLowerCase() on it crashes React before the page renders.
---

## Rule
Always use `(romajiTitle ?? "")` (not `romajiTitle`) when constructing any template string that calls string methods in JSX.

## Why
The MIRURO overlay renders as soon as `server === "MIRURO" && !miruroIframeUrl`. MIRURO's HEAD-check returns 503 in ~200–300ms, setting `miruroError` before AniList GraphQL finishes loading (2–5s). At that point `romajiTitle = anime?.title.romaji` is still `undefined`. Calling `.toLowerCase()` on it throws a TypeError that crashes the React component tree.

## How to apply
In any JSX that uses `romajiTitle` (or any nullable field derived from `anime`), use `(romajiTitle ?? "")` or optional chaining before calling string methods.

---
name: VoidStream server integration
description: How the VOIDSTREAM server option resolves streams without needing voidstream.space's own login/session.
---

voidstream.space (canonical domain per its sitemap: voidstream.app, which didn't
resolve at investigation time) requires sign-in/guest session to render its own
player, and its `/embed`, `/api` paths 500 without that session — there is no
public embed endpoint to proxy directly.

Its client JS bundle reveals it doesn't host video itself: it resolves a TMDB id
(+ season/episode for TV) and builds an iframe src for one of ~15 public embed
aggregators (vidapi.xyz "sukuna", player.videasy.net, vidfast.to, vidsrc.me,
vidnest.fun, vidrock.net, 111movies.com, multiembed.mov, etc). Those provider
URLs have no X-Frame-Options and accept the TMDB id directly — so the
integration builds those URLs itself instead of touching VoidStream's account
system at all.

**Why:** avoids fragile reverse-engineering of a third-party login/session flow;
same end-user result (a working iframe player) with none of the auth risk.

**How to apply:** AniList doesn't expose a TMDB id — resolve
`anilist_id -> themoviedb_id{movie,tv} + season.tmdb + episode_offset.tmdb` via
the Fribb/anime-lists community mapping (`lib/fribb-mapping.ts`, shared with the
logo-lookup route's Fanart.tv flow). vidsrc.me specifically requires the
query-param form `/embed/tv?tmdb=ID&season=S&episode=E` (path-segment forms
404); it redirects to vidsrcme.ru, which is also X-Frame-Options-free.

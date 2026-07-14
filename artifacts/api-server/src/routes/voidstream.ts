import { Router } from "express";
import { loadFribbMapping } from "../lib/fribb-mapping";

/**
 * "VOIDSTREAM" server.
 *
 * voidstream.space itself is a TMDB-keyed frontend that requires a
 * sign-in/guest session to render its own player page, and its /embed and
 * /api paths 500 without that session — there is no public embed endpoint to
 * proxy. However its client bundle reveals it does not host video itself: it
 * just resolves a TMDB id (+ season/episode for TV) and builds an iframe src
 * for one of a dozen public embed aggregators (vidsrc.me, vidfast, videasy,
 * vidnest, letsembed, multiembed, etc). Those provider embed URLs have no
 * X-Frame-Options and take the TMDB id directly, so we build them ourselves
 * — same end result (a working iframe player) without needing VoidStream's
 * account system at all.
 *
 * AniList doesn't expose a TMDB id directly, so we resolve
 * anilist_id -> themoviedb_id (+ season number) via the same Fribb/anime-lists
 * community mapping already used for logo lookups.
 */

const router = Router();

interface ProviderDef {
  id: string;
  label: string;
  /** Builds the iframe src for a movie given its TMDB id. */
  movieUrl: (tmdbId: number) => string;
  /** Builds the iframe src for a TV episode given TMDB id + season + episode. */
  tvUrl: (tmdbId: number, season: number, episode: number) => string;
}

// Mirrors the provider switch statement in voidstream.space's own client bundle.
// Ordered with anime-focused / generally reliable providers first.
const PROVIDERS: ProviderDef[] = [
  {
    id: "sukuna",
    label: "VoidStream (Anime)",
    movieUrl: (id) => `https://vidapi.xyz/embed/movie/${id}`,
    tvUrl: (id, s, e) => `https://vidapi.xyz/embed/tv/${id}?s=${s}&e=${e}`,
  },
  {
    id: "videasy",
    label: "VoidStream (Fast)",
    movieUrl: (id) => `https://player.videasy.net/movie/${id}`,
    tvUrl: (id, s, e) => `https://player.videasy.net/tv/${id}/${s}/${e}`,
  },
  {
    id: "vidfast",
    label: "VoidStream (HD)",
    movieUrl: (id) => `https://vidfast.to/embed/movie/${id}`,
    tvUrl: (id, s, e) => `https://vidfast.to/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: "vidsrc",
    label: "VoidStream (Super)",
    movieUrl: (id) => `https://vidsrc.me/embed/movie?tmdb=${id}`,
    tvUrl: (id, s, e) => `https://vidsrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}`,
  },
  {
    id: "vidnest",
    label: "VoidStream (Alt)",
    movieUrl: (id) => `https://vidnest.fun/movie/${id}`,
    tvUrl: (id, s, e) => `https://vidnest.fun/tv/${id}/${s}/${e}`,
  },
  {
    id: "vidrock",
    label: "VoidStream (Clean)",
    movieUrl: (id) => `https://vidrock.net/movie/${id}`,
    tvUrl: (id, s, e) => `https://vidrock.net/tv/${id}/${s}/${e}`,
  },
  {
    id: "atomic",
    label: "VoidStream (111)",
    movieUrl: (id) => `https://111movies.com/movie/${id}`,
    tvUrl: (id, s, e) => `https://111movies.com/tv/${id}/${s}/${e}`,
  },
  {
    id: "superembed",
    label: "VoidStream (Multi)",
    movieUrl: (id) => `https://multiembed.mov/directstream.php?video_id=${id}&tmdb=1`,
    tvUrl: (id, s, e) => `https://multiembed.mov/directstream.php?video_id=${id}&tmdb=1&s=${s}&e=${e}`,
  },
];

interface ResolveResult {
  tmdbId: number;
  kind: "movie" | "tv";
  season: number;
  episodeOffset: number;
}

async function resolveTmdb(anilistId: number): Promise<ResolveResult | null> {
  const mapping = await loadFribbMapping();
  const entry = mapping.get(anilistId);
  if (!entry || !entry.themoviedb_id) return null;

  if (typeof entry.themoviedb_id === "number") {
    // Legacy shape: bare number, ambiguous — treat as movie (rare in current dataset).
    return { tmdbId: entry.themoviedb_id, kind: "movie", season: 1, episodeOffset: 0 };
  }

  if (entry.themoviedb_id.tv) {
    return {
      tmdbId: entry.themoviedb_id.tv,
      kind: "tv",
      season: entry.season?.tmdb ?? 1,
      episodeOffset: entry.episode_offset?.tmdb ?? 0,
    };
  }

  if (entry.themoviedb_id.movie) {
    return { tmdbId: entry.themoviedb_id.movie, kind: "movie", season: 1, episodeOffset: 0 };
  }

  return null;
}

/**
 * GET /api/voidstream/stream?anilistId=...&ep=...
 * Resolves the AniList id to a TMDB id via the Fribb mapping, then returns
 * a ranked list of embeddable iframe URLs (one per provider) for the caller
 * to try in order, mirroring the cascading-fallback UX already used for
 * other multi-provider servers (GOGO, KOTO) in this app.
 */
router.get("/voidstream/stream", async (req, res) => {
  const anilistIdRaw = (req.query.anilistId as string | undefined)?.trim();
  const ep = (req.query.ep as string | undefined)?.trim();

  const anilistId = Number(anilistIdRaw);
  if (!anilistIdRaw || !Number.isFinite(anilistId) || anilistId <= 0) {
    res.status(400).json({ error: "anilistId query param required" });
    return;
  }

  const epNum = ep ? parseInt(ep, 10) : 1;
  if (!Number.isFinite(epNum) || epNum <= 0) {
    res.status(400).json({ error: `Invalid ep: "${ep}"` });
    return;
  }

  try {
    const resolved = await resolveTmdb(anilistId);
    if (!resolved) {
      res.status(404).json({ error: "No TMDB mapping found for this title on VoidStream" });
      return;
    }

    const episode = epNum + resolved.episodeOffset;
    const sources = PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      iframeUrl: resolved.kind === "movie" ? p.movieUrl(resolved.tmdbId) : p.tvUrl(resolved.tmdbId, resolved.season, episode),
    }));

    res.json({
      tmdbId: resolved.tmdbId,
      kind: resolved.kind,
      season: resolved.season,
      episode,
      sources,
      iframeUrl: sources[0].iframeUrl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.warn("[voidstream] resolve failed:", msg);
    res.status(502).json({ error: `VoidStream mapping lookup failed: ${msg}` });
  }
});

export default router;

import { Router } from "express";
import { loadFribbMapping } from "../lib/fribb-mapping";
import { extractHlsFromEmbed, extractHlsBatch } from "../lib/voidstream-hls-extractor";

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
// Confirmed reachable from Replit IPs via HEAD check before adding.
const PROVIDERS: ProviderDef[] = [
  // voidstream.space itself — navigates the real site so its own S1→S2 auto-switching
  // is executed by the browser. Intercepts whatever server fires the m3u8.
  {
    id: "voidstream",
    label: "VoidStream (Direct)",
    movieUrl: (id) => `https://voidstream.space/watch/movie-${id}`,
    tvUrl: (id, s, e) => `https://voidstream.space/watch/tv-${id}?season=${s}&ep=${e}`,
  },
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
  // vidsrc.to — separate backend from vidsrc.me, confirmed reachable
  {
    id: "vidsrcto",
    label: "VoidStream (S2)",
    movieUrl: (id) => `https://vidsrc.to/embed/movie/${id}`,
    tvUrl: (id, s, e) => `https://vidsrc.to/embed/tv/${id}/${s}/${e}`,
  },
  // 2embed.skin — confirmed reachable, mirrors VoidStream Server 2
  {
    id: "twoembedsk",
    label: "VoidStream (S3)",
    movieUrl: (id) => `https://2embed.skin/embed/movie/${id}`,
    tvUrl: (id, s, e) => `https://2embed.skin/embed/tv/${id}/${s}/${e}`,
  },
  // smashystream — confirmed reachable, used by VoidStream and others
  {
    id: "smashy",
    label: "VoidStream (S4)",
    movieUrl: (id) => `https://smashystream.xyz/playere.php?tmdb=${id}&type=movie`,
    tvUrl: (id, s, e) => `https://smashystream.xyz/playere.php?tmdb=${id}&s=${s}&e=${e}`,
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

/**
 * GET /api/voidstream/stream-hls?anilistId=...&ep=...
 * One-shot endpoint: resolves TMDB, builds all provider embed URLs, then
 * tries them ALL IN PARALLEL via the singleton Puppeteer browser.
 * Returns the first working HLS URL plus the full sources list (for the
 * manual provider picker in the UI).
 */
router.get("/voidstream/stream-hls", async (req, res) => {
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
      iframeUrl: resolved.kind === "movie"
        ? p.movieUrl(resolved.tmdbId)
        : p.tvUrl(resolved.tmdbId, resolved.season, episode),
    }));

    // Try all providers in parallel — first hit wins
    const hit = await extractHlsBatch(sources);

    if (!hit) {
      // Return sources even on failure so the UI can show the provider picker
      res.status(502).json({
        sources,
        error: "No VoidStream provider returned a working stream for this episode",
      });
      return;
    }

    const providerIndex = sources.findIndex((s) => s.id === hit.providerId);

    // Proxy the HLS manifest through our server so the browser gets the right
    // Referer on every segment request (CDNs like shysmoke/primebox Workers check it).
    const hlsProxy = `/api/anizone/hls?u=${Buffer.from(hit.hlsUrl).toString("base64url")}&ref=${Buffer.from(hit.embedUrl).toString("base64url")}`;

    res.json({
      sources,
      hlsUrl: hlsProxy,
      providerId: hit.providerId,
      providerLabel: hit.providerLabel,
      providerIndex: providerIndex >= 0 ? providerIndex : 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.warn("[voidstream] stream-hls failed:", msg);
    res.status(502).json({ error: `VoidStream batch extraction failed: ${msg}` });
  }
});

/**
 * GET /api/voidstream/hls?url=<encodedEmbedUrl>
 * Uses Puppeteer to navigate to a third-party embed provider page and
 * intercept the HLS manifest (.m3u8) URL the player fetches internally.
 * Returns the raw stream URL so the frontend can use our native HLS player
 * instead of showing the embed iframe — eliminates ads and popup redirects.
 */
router.get("/voidstream/hls", async (req, res) => {
  const embedUrl = (req.query.url as string | undefined)?.trim();
  if (!embedUrl) {
    res.status(400).json({ error: "url query param required" });
    return;
  }

  try {
    const hlsUrl = await extractHlsFromEmbed(embedUrl);
    if (!hlsUrl) {
      res.status(502).json({ error: "Could not extract HLS stream from this provider" });
      return;
    }
    // Proxy through our HLS relay so the CDN sees the embed page as Referer
    const hlsProxy = `/api/anizone/hls?u=${Buffer.from(hlsUrl).toString("base64url")}&ref=${Buffer.from(embedUrl).toString("base64url")}`;
    res.json({ hlsUrl: hlsProxy });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.warn("[voidstream-hls] route error:", msg);
    res.status(502).json({ error: `HLS extraction failed: ${msg}` });
  }
});

export default router;

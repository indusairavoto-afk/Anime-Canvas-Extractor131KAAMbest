import { Router } from "express";

/**
 * Anime logo lookup: AniList ID -> TheTVDB ID (via the Fribb/anime-lists
 * community mapping) -> Fanart.tv clear logo (transparent title PNG).
 *
 * Fanart.tv keys its TV logos by TheTVDB ID, and AniList doesn't expose one
 * directly, so we go through the static Fribb mapping file first.
 */

const router = Router();

const MAPPING_URL =
  "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";

interface MappingEntry {
  anilist_id?: number;
  tvdb_id?: number;
  themoviedb_id?: { movie?: number; tv?: number } | number;
}

let mappingCache: Map<number, MappingEntry> | null = null;
let mappingLoadedAt = 0;
const MAPPING_TTL_MS = 24 * 60 * 60 * 1000; // 24h
let mappingLoadPromise: Promise<Map<number, MappingEntry>> | null = null;

async function loadMapping(): Promise<Map<number, MappingEntry>> {
  if (mappingCache && Date.now() - mappingLoadedAt < MAPPING_TTL_MS) {
    return mappingCache;
  }
  if (mappingLoadPromise) return mappingLoadPromise;

  mappingLoadPromise = (async () => {
    const res = await fetch(MAPPING_URL, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`mapping fetch failed: ${res.status}`);
    const list = (await res.json()) as MappingEntry[];
    const map = new Map<number, MappingEntry>();
    for (const entry of list) {
      if (entry.anilist_id) map.set(entry.anilist_id, entry);
    }
    mappingCache = map;
    mappingLoadedAt = Date.now();
    return map;
  })();

  try {
    return await mappingLoadPromise;
  } finally {
    mappingLoadPromise = null;
  }
}

interface FanartImage {
  id: string;
  url: string;
  lang: string;
  likes: string;
}

interface FanartTvResponse {
  hdtvlogo?: FanartImage[];
  clearlogo?: FanartImage[];
}

interface FanartMovieResponse {
  hdmovielogo?: FanartImage[];
  movielogo?: FanartImage[];
}

function pickBestLogo(images: FanartImage[] | undefined): string | null {
  if (!images || images.length === 0) return null;
  const sorted = [...images].sort((a, b) => {
    // Prefer English logos, then by like count.
    const aEn = a.lang === "en" ? 1 : 0;
    const bEn = b.lang === "en" ? 1 : 0;
    if (aEn !== bEn) return bEn - aEn;
    return Number(b.likes || 0) - Number(a.likes || 0);
  });
  return sorted[0].url;
}

const logoResultCache = new Map<number, { url: string | null; ts: number }>();
const RESULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_CACHE_ENTRIES = 5000;

function setCachedLogo(anilistId: number, url: string | null) {
  // Bound cache size: evict the oldest entry (Map preserves insertion order)
  // before inserting a new one, so long-uptime servers can't grow unbounded.
  if (logoResultCache.size >= MAX_CACHE_ENTRIES && !logoResultCache.has(anilistId)) {
    const oldestKey = logoResultCache.keys().next().value;
    if (oldestKey !== undefined) logoResultCache.delete(oldestKey);
  }
  logoResultCache.set(anilistId, { url, ts: Date.now() });
}

async function fetchFanartLogo(anilistId: number): Promise<string | null> {
  const apiKey = process.env.FANART_API_KEY;
  if (!apiKey) return null;

  const mapping = await loadMapping();
  const entry = mapping.get(anilistId);
  if (!entry) return null;

  // Try TV logo via TheTVDB id first (most anime are catalogued as TV series).
  if (entry.tvdb_id) {
    try {
      const res = await fetch(
        `https://webservice.fanart.tv/v3/tv/${entry.tvdb_id}?api_key=${apiKey}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (res.ok) {
        const data = (await res.json()) as FanartTvResponse;
        const logo = pickBestLogo(data.hdtvlogo) ?? pickBestLogo(data.clearlogo);
        if (logo) return logo;
      }
    } catch {
      // fall through to movie lookup
    }
  }

  // Fall back to movie logo via TMDB id (for anime films).
  const tmdbId =
    typeof entry.themoviedb_id === "object" ? entry.themoviedb_id?.movie : undefined;
  if (tmdbId) {
    try {
      const res = await fetch(
        `https://webservice.fanart.tv/v3/movies/${tmdbId}?api_key=${apiKey}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (res.ok) {
        const data = (await res.json()) as FanartMovieResponse;
        const logo = pickBestLogo(data.hdmovielogo) ?? pickBestLogo(data.movielogo);
        if (logo) return logo;
      }
    } catch {
      // no logo available
    }
  }

  return null;
}

router.get("/logo/:anilistId", async (req, res) => {
  const anilistId = Number(req.params.anilistId);
  if (!Number.isFinite(anilistId) || anilistId <= 0) {
    res.status(400).json({ error: "invalid anilistId" });
    return;
  }

  const cached = logoResultCache.get(anilistId);
  if (cached && Date.now() - cached.ts < RESULT_TTL_MS) {
    res.json({ logoUrl: cached.url });
    return;
  }

  try {
    const logoUrl = await fetchFanartLogo(anilistId);
    setCachedLogo(anilistId, logoUrl);
    res.json({ logoUrl });
  } catch (err) {
    console.warn("[logo] lookup failed:", err);
    res.json({ logoUrl: null });
  }
});

export default router;

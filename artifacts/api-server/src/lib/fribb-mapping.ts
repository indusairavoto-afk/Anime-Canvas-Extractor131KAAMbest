/**
 * Shared AniList ID -> TVDB/TMDB mapping via the Fribb/anime-lists community
 * dataset. Multiple routes (logo lookup, VoidStream embed resolution) need
 * this same mapping, so it lives here once with a shared 24h in-memory cache
 * instead of each route re-fetching the ~5MB JSON file independently.
 */

const MAPPING_URL =
  "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";

export interface FribbMappingEntry {
  anilist_id?: number;
  mal_id?: number;
  tvdb_id?: number;
  imdb_id?: string[];
  type?: string;
  season?: { tmdb?: number; tvdb?: number };
  episode_offset?: { tmdb?: number; tvdb?: number };
  themoviedb_id?: { movie?: number; tv?: number } | number;
}

let mappingCache: Map<number, FribbMappingEntry> | null = null;
let mappingLoadedAt = 0;
const MAPPING_TTL_MS = 24 * 60 * 60 * 1000; // 24h
let mappingLoadPromise: Promise<Map<number, FribbMappingEntry>> | null = null;

export async function loadFribbMapping(): Promise<Map<number, FribbMappingEntry>> {
  if (mappingCache && Date.now() - mappingLoadedAt < MAPPING_TTL_MS) {
    return mappingCache;
  }
  if (mappingLoadPromise) return mappingLoadPromise;

  mappingLoadPromise = (async () => {
    const res = await fetch(MAPPING_URL, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`mapping fetch failed: ${res.status}`);
    const list = (await res.json()) as FribbMappingEntry[];
    const map = new Map<number, FribbMappingEntry>();
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

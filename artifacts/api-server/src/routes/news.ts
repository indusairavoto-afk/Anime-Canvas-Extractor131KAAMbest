import { Router } from "express";

const router = Router();

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 15 * 60 * 1000; // 15 minutes

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, expiresAt: Date.now() + TTL_MS });
}

router.get("/news/anime", async (_req, res) => {
  try {
    const cacheKey = "anime-news";
    const cached = getCached(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const response = await fetch(
      "https://api.jikan.moe/v4/news/anime?page=1",
      {
        headers: {
          "User-Agent": "NexaAnime/1.0",
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      res.status(response.status).json({ error: `Jikan returned ${response.status}` });
      return;
    }

    const json = await response.json();
    setCache(cacheKey, json);
    res.json(json);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch anime news" });
  }
});

export default router;

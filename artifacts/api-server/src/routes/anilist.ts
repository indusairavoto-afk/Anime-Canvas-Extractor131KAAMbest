import { Router } from "express";

const router = Router();

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

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
  // Evict oldest entries if cache grows large
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

router.post("/anilist", async (req, res) => {
  try {
    const cacheKey = JSON.stringify(req.body);
    const cached = getCached(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `AniList returned ${response.status}` });
      return;
    }

    const data = await response.json() as Record<string, unknown>;

    const hasErrors = Array.isArray((data as { errors?: unknown[] }).errors) && (data as { errors?: unknown[] }).errors!.length > 0;
    if (!hasErrors) {
      setCache(cacheKey, data);
    }

    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "AniList request failed" });
  }
});

export default router;

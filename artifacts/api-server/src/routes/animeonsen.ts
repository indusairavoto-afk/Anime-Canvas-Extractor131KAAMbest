import { Router } from "express";

const router = Router();

const ANIMEONSEN_ORIGIN = "https://www.animeonsen.xyz";
const SEARCH_API = "https://search.animeonsen.xyz";
const SEARCH_TOKEN = "0e36d0275d16b40d7cf153634df78bc229320d073f565db2aaf6d027e0c30b13";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

interface SearchHit {
  content_id: string;
  content_title: string;
  content_title_en: string;
  content_title_jp: string;
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function scoreHit(hit: SearchHit, query: string): number {
  const qNorm = normalizeTitle(query);
  const titles = [
    normalizeTitle(hit.content_title ?? ""),
    normalizeTitle(hit.content_title_en ?? ""),
    normalizeTitle(hit.content_title_jp ?? ""),
  ];
  let best = 0;
  for (const t of titles) {
    if (!t) continue;
    let score = 0;
    if (t === qNorm) { score = 1000; }
    else if (t.startsWith(qNorm)) { score = 800; }
    else if (qNorm.startsWith(t)) { score = 700; }
    else if (t.includes(qNorm)) { score = 500; }
    else if (qNorm.includes(t)) { score = 400; }
    else {
      const qWords = new Set(qNorm.split(" ").filter(Boolean));
      const tWords = t.split(" ").filter(Boolean);
      const overlap = tWords.filter(w => qWords.has(w)).length;
      score = overlap * 60;
    }
    if (score > best) best = score;
  }
  return best;
}

function buildQueryVariants(rawTitle: string): string[] {
  const variants: string[] = [rawTitle];

  // Strip season/part info
  const noSeason = rawTitle.replace(/\s*(season|part)\s*\d+/gi, "").trim();
  if (noSeason && noSeason !== rawTitle) variants.push(noSeason);
  const noOrdinal = rawTitle.replace(/\s*\d+(st|nd|rd|th)\s*season/gi, "").trim();
  if (noOrdinal && noOrdinal !== rawTitle) variants.push(noOrdinal);

  // First 5 words (useful for long titles)
  const words = rawTitle.trim().split(/\s+/);
  if (words.length > 5) {
    variants.push(words.slice(0, 5).join(" "));
  }
  // First 3 words
  if (words.length > 3) {
    variants.push(words.slice(0, 3).join(" "));
  }
  // Without stop words ("of", "the", "a", "an", "in", "on", "at", "to")
  const stops = new Set(["of", "the", "a", "an", "in", "on", "at", "to", "and"]);
  const noStops = words.filter(w => !stops.has(w.toLowerCase())).join(" ");
  if (noStops && noStops !== rawTitle) variants.push(noStops);

  // Deduplicate while preserving order
  return variants.filter((q, i, arr) => q && arr.indexOf(q) === i);
}

async function searchContentId(titles: string[]): Promise<{ contentId: string; matchedTitle: string } | null> {
  for (const rawTitle of titles) {
    if (!rawTitle) continue;
    const queries = buildQueryVariants(rawTitle);

    for (const query of queries) {
      if (!query) continue;
      try {
        const resp = await fetch(`${SEARCH_API}/indexes/content/search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SEARCH_TOKEN}`,
            Origin: ANIMEONSEN_ORIGIN,
            Referer: `${ANIMEONSEN_ORIGIN}/`,
            ...BROWSER_HEADERS,
          },
          body: JSON.stringify({ q: query, limit: 8 }),
          signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) continue;
        const data = (await resp.json()) as { hits: SearchHit[] };
        if (!data.hits?.length) continue;

        let best: { hit: SearchHit; score: number } | null = null;
        for (const hit of data.hits) {
          const score = scoreHit(hit, rawTitle);
          if (!best || score > best.score) best = { hit, score };
        }
        // Lower threshold to 120 (≥2 matching words) to catch partial matches
        if (best && best.score >= 120) {
          return { contentId: best.hit.content_id, matchedTitle: best.hit.content_title_en || best.hit.content_title };
        }
      } catch {
        // continue to next query variant
      }
    }
  }
  return null;
}

/**
 * GET /api/animeonsen/video?contentId=...&ep=...
 *
 * Server-side proxy for the AnimeonSen v4 video API.
 * Returns the direct DASH/HLS stream URL and subtitle URL.
 * Done server-side to bypass CORS restrictions on api.animeonsen.xyz.
 */
router.get("/animeonsen/video", async (req, res) => {
  const contentId = (req.query.contentId as string | undefined)?.trim() ?? "";
  const ep = (req.query.ep as string | undefined)?.trim() ?? "1";

  if (!contentId) {
    res.status(400).json({ error: "contentId is required" });
    return;
  }
  const epNum = parseInt(ep);
  if (isNaN(epNum) || epNum <= 0) {
    res.status(400).json({ error: `Invalid ep: "${ep}"` });
    return;
  }

  try {
    const apiResp = await fetch(
      `https://api.animeonsen.xyz/v4/content/${encodeURIComponent(contentId)}/video/${epNum}`,
      {
        headers: {
          ...BROWSER_HEADERS,
          Origin: ANIMEONSEN_ORIGIN,
          Referer: `${ANIMEONSEN_ORIGIN}/`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!apiResp.ok) {
      res.status(apiResp.status).json({ error: `AnimeonSen API returned ${apiResp.status}` });
      return;
    }

    const json = await apiResp.json() as { data?: { uri?: { stream?: string; subtitles?: string } } };
    const streamUrl = json.data?.uri?.stream ?? null;
    const subtitleUrl = json.data?.uri?.subtitles ?? null;

    if (!streamUrl) {
      res.status(404).json({ error: "No stream URL in AnimeonSen response" });
      return;
    }

    res.json({ streamUrl, subtitleUrl });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: `AnimeonSen proxy error: ${msg}` });
  }
});

/**
 * GET /api/animeonsen/stream?title=...&romajiTitle=...&ep=...
 *
 * Searches AnimeonSen for the given title, resolves the content_id,
 * and returns the direct watch URL (embeddable as iframe).
 */
router.get("/animeonsen/stream", async (req, res) => {
  const title = (req.query.title as string | undefined)?.trim() ?? "";
  const romajiTitle = (req.query.romajiTitle as string | undefined)?.trim() ?? "";
  const ep = (req.query.ep as string | undefined)?.trim() ?? "1";
  const cachedContentId = (req.query.contentId as string | undefined)?.trim() ?? "";

  const epNum = parseInt(ep);
  if (isNaN(epNum) || epNum <= 0) {
    res.status(400).json({ error: `Invalid ep: "${ep}"` });
    return;
  }

  // If caller already has a cached content_id, skip search
  if (cachedContentId) {
    const iframeUrl = `${ANIMEONSEN_ORIGIN}/watch/${cachedContentId}?episode=${epNum}`;
    res.json({ iframeUrl, contentId: cachedContentId });
    return;
  }

  if (!title && !romajiTitle) {
    res.status(400).json({ error: "title or romajiTitle required" });
    return;
  }

  const result = await searchContentId([title, romajiTitle].filter(Boolean));
  if (!result) {
    res.status(404).json({ error: "Anime not found on AnimeonSen" });
    return;
  }

  const iframeUrl = `${ANIMEONSEN_ORIGIN}/watch/${result.contentId}?episode=${epNum}`;
  res.json({ iframeUrl, contentId: result.contentId, matchedTitle: result.matchedTitle });
});

export default router;

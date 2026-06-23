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

/**
 * Score a search hit against a query.
 * Higher = better match.
 */
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
      // word overlap
      const qWords = new Set(qNorm.split(" ").filter(Boolean));
      const tWords = t.split(" ").filter(Boolean);
      const overlap = tWords.filter(w => qWords.has(w)).length;
      score = overlap * 60;
    }
    if (score > best) best = score;
  }
  return best;
}

/**
 * Search animeonsen for a given anime title.
 * Tries the given query, then a cleaned-up version without season words.
 * Returns the best-matching content_id or null.
 */
async function searchContentId(titles: string[]): Promise<{ contentId: string; matchedTitle: string } | null> {
  for (const rawTitle of titles) {
    if (!rawTitle) continue;

    // Also try without season info
    const queries = [
      rawTitle,
      rawTitle.replace(/\s*(season|part)\s*\d+/gi, "").trim(),
      rawTitle.replace(/\s*\d+(st|nd|rd|th)\s*season/gi, "").trim(),
    ].filter((q, i, arr) => q && arr.indexOf(q) === i);

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
          body: JSON.stringify({ q: query, limit: 5 }),
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
        if (best && best.score >= 200) {
          return { contentId: best.hit.content_id, matchedTitle: best.hit.content_title_en || best.hit.content_title };
        }
      } catch {
        // continue
      }
    }
  }
  return null;
}

/**
 * GET /api/animeonsen/stream?title=...&romajiTitle=...&ep=...
 *
 * Searches AnimeonSen for the given title, resolves the content_id,
 * and returns the direct watch URL (embeddable as iframe — no X-Frame-Options).
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

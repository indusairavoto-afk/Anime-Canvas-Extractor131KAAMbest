import { Router } from "express";

const router = Router();
const BASE = "https://api.mangadex.org";
const UA = "NaAnime/1.0 (github.com/na-anime)";

const HEADERS = { "User-Agent": UA, Accept: "application/json" };

async function mdFetch(path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`MangaDex ${res.status}: ${path}`);
  return res.json() as Promise<Record<string, unknown>>;
}

/**
 * GET /api/mangadex/search?title=...
 * Returns the best-matching manga id + title.
 */
router.get("/mangadex/search", async (req, res) => {
  const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
  if (!title) { res.status(400).json({ error: "title required" }); return; }

  try {
    const qs = new URLSearchParams({
      title,
      limit: "10",
      "order[relevance]": "desc",
    });
    ["safe","suggestive","erotica","pornographic"].forEach(r => qs.append("contentRating[]", r));

    const data = await mdFetch(`/manga?${qs}`) as { data: MangaDxManga[] };
    if (!data.data?.length) { res.json({ found: false }); return; }

    // Score: exact english title match > exact romaji match > first result
    const q = title.toLowerCase();
    let best = data.data[0];
    for (const m of data.data) {
      const en = (m.attributes?.title?.en ?? "").toLowerCase();
      const ro = (m.attributes?.title?.["ja-ro"] ?? "").toLowerCase();
      if (en === q || ro === q) { best = m; break; }
    }

    res.json({
      found: true,
      mangaId: best.id,
      title: best.attributes?.title?.en ?? best.attributes?.title?.["ja-ro"] ?? title,
    });
  } catch (err) {
    req.log.error(err);
    res.status(502).json({ error: "MangaDex unavailable" });
  }
});

/**
 * GET /api/mangadex/chapters?mangaId=...&offset=0
 * Returns chapters (English, with pages, unique by chapter number).
 */
router.get("/mangadex/chapters", async (req, res) => {
  const mangaId = typeof req.query.mangaId === "string" ? req.query.mangaId.trim() : "";
  const offset = Number(req.query.offset ?? 0) || 0;
  if (!mangaId) { res.status(400).json({ error: "mangaId required" }); return; }

  try {
    const qs = new URLSearchParams({
      "translatedLanguage[]": "en",
      "order[volume]": "asc",
      "order[chapter]": "asc",
      limit: "100",
      offset: String(offset),
    });
    const data = await mdFetch(`/manga/${mangaId}/feed?${qs}`) as { data: MangaDxChapter[]; total: number };

    // Keep only chapters that have actual pages hosted on MangaDex (not external links)
    const seen = new Set<string>();
    const chapters = (data.data ?? [])
      .filter(ch => ch.attributes.pages > 0 && !ch.attributes.externalUrl)
      .filter(ch => {
        const key = ch.attributes.chapter ?? ch.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(ch => ({
        id: ch.id,
        chapter: ch.attributes.chapter,
        volume: ch.attributes.volume,
        title: ch.attributes.title,
        pages: ch.attributes.pages,
      }));

    res.json({ chapters, total: data.total, offset });
  } catch (err) {
    req.log.error(err);
    res.status(502).json({ error: "MangaDex unavailable" });
  }
});

/**
 * GET /api/mangadex/pages?chapterId=...
 * Returns proxied image URLs for each page.
 */
router.get("/mangadex/pages", async (req, res) => {
  const chapterId = typeof req.query.chapterId === "string" ? req.query.chapterId.trim() : "";
  if (!chapterId) { res.status(400).json({ error: "chapterId required" }); return; }

  try {
    const data = await mdFetch(`/at-home/server/${chapterId}`) as MangaDxAtHome;
    const { baseUrl, chapter } = data;
    if (!chapter?.hash || !chapter?.data) {
      res.status(404).json({ error: "No pages found" });
      return;
    }

    const pages = chapter.data.map((filename: string) =>
      `/api/mangadex/img?url=${encodeURIComponent(`${baseUrl}/data/${chapter.hash}/${filename}`)}`
    );

    res.json({ pages, total: pages.length });
  } catch (err) {
    req.log.error(err);
    res.status(502).json({ error: "MangaDex unavailable" });
  }
});

/**
 * GET /api/mangadex/img?url=...
 * Proxies a MangaDex CDN image with the required headers.
 */
router.get("/mangadex/img", async (req, res) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  if (!url || !url.startsWith("https://")) {
    res.status(400).json({ error: "Invalid url" });
    return;
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Referer: "https://mangadex.org/",
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }

    const ct = upstream.headers.get("content-type") ?? "image/jpeg";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const buf = await upstream.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err) {
    req.log.error(err);
    res.status(502).end();
  }
});

/**
 * GET /api/mangadex/by-anilist?alId=...&title=...
 * Finds a MangaDex manga by AniList ID (checks links.al field).
 * Falls back to title search if needed.
 */
router.get("/mangadex/by-anilist", async (req, res) => {
  const alId = typeof req.query.alId === "string" ? req.query.alId.trim() : "";
  const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
  if (!alId) { res.status(400).json({ error: "alId required" }); return; }

  try {
    const qs = new URLSearchParams({ limit: "10", "order[relevance]": "desc" });
    if (title) qs.set("title", title);
    ["safe","suggestive","erotica","pornographic"].forEach(r => qs.append("contentRating[]", r));

    const data = await mdFetch(`/manga?${qs}`) as { data: MangaDxMangaFull[] };
    if (!data.data?.length) { res.json({ found: false }); return; }

    const match = data.data.find(m => String(m.attributes?.links?.al ?? "") === alId);
    const best = match ?? data.data[0];

    res.json({
      found: true,
      mangaId: best.id,
      title: best.attributes?.title?.en ?? best.attributes?.title?.["ja-ro"] ?? title,
    });
  } catch (err) {
    req.log.error(err);
    res.status(502).json({ error: "MangaDex unavailable" });
  }
});

// ---- Types ----

interface MangaDxManga {
  id: string;
  attributes: {
    title: Record<string, string>;
  };
}

interface MangaDxMangaFull {
  id: string;
  attributes: {
    title: Record<string, string>;
    links?: Record<string, string>;
  };
}

interface MangaDxChapter {
  id: string;
  attributes: {
    chapter: string | null;
    volume: string | null;
    title: string | null;
    pages: number;
    externalUrl: string | null;
  };
}

interface MangaDxAtHome {
  baseUrl: string;
  chapter: {
    hash: string;
    data: string[];
    dataSaver: string[];
  };
}

export default router;

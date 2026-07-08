import { Router } from "express";

const router = Router();

const WC_BASE = "https://weebcentral.com";

interface WcChapter {
  id: string;
  number: number;
  title: string | null;
  index: number;
}

interface WcSearchResult {
  id: string;
  title: string;
  image: string;
}

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://weebcentral.com/",
};

async function searchWeebCentral(query: string): Promise<WcSearchResult[]> {
  const res = await fetch(`${WC_BASE}/search/simple?location=main`, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ text: query }).toString(),
  });
  if (!res.ok) throw new Error(`weebcentral search HTTP ${res.status}`);
  const html = await res.text();

  const results: WcSearchResult[] = [];
  const anchorRe = /<a href="https:\/\/weebcentral\.com\/series\/([^/"]+)\/[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const id = m[1];
    const block = m[2];
    const titleMatch = block.match(/<div class="flex-1[^"]*">\s*([\s\S]*?)\s*<\/div>/);
    const title = titleMatch ? titleMatch[1].trim() : "";
    const imgMatch = block.match(/<img[^>]+src="([^"]+)"/);
    const image = imgMatch ? imgMatch[1] : "";
    if (title) results.push({ id, title, image });
  }
  return results;
}

function pickBestMatch(results: WcSearchResult[], title: string): WcSearchResult | null {
  if (!results.length) return null;
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = normalise(title);
  for (const r of results) {
    if (normalise(r.title) === target) return r;
  }
  return results[0];
}

async function fetchChapters(seriesId: string): Promise<WcChapter[]> {
  const res = await fetch(`${WC_BASE}/series/${seriesId}/full-chapter-list`, {
    headers: BROWSER_HEADERS,
  });
  if (!res.ok) return [];
  const html = await res.text();

  const chapters: WcChapter[] = [];
  const chapterRe = /<a href="https:\/\/weebcentral\.com\/chapters\/([^"]+)"[^>]*>[\s\S]*?<span class="grow[^"]*">\s*<span[^>]*>([^<]*)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = chapterRe.exec(html)) !== null) {
    const id = m[1];
    const label = m[2].trim();
    const numMatch = label.match(/(\d+(?:\.\d+)?)/);
    const number = numMatch ? parseFloat(numMatch[1]) : 0;
    chapters.push({ id, number, title: label || null, index: 0 });
  }
  chapters.reverse();
  chapters.forEach((c, i) => { c.index = i; });
  return chapters;
}

async function fetchChapterPages(chapterId: string): Promise<string[]> {
  const res = await fetch(`${WC_BASE}/chapters/${chapterId}/images?is_prev=False&reading_style=long_strip`, {
    headers: BROWSER_HEADERS,
  });
  if (!res.ok) return [];
  const html = await res.text();

  const pages: string[] = [];
  const imgRe = /<img\s+src="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const src = m[1];
    if (src.includes("broken_image") || src.includes("logo") || src.includes("icon")) continue;
    pages.push(src);
  }
  return pages;
}

router.get("/weebcentral/find", async (req, res) => {
  const title = String(req.query.title ?? "").trim();
  if (!title) {
    res.json({ found: false });
    return;
  }

  try {
    let results = await searchWeebCentral(title);
    let match = pickBestMatch(results, title);

    if (!match) {
      const shorter = title.split(":")[0].trim();
      if (shorter !== title) {
        results = await searchWeebCentral(shorter);
        match = pickBestMatch(results, shorter);
      }
    }

    if (!match) {
      res.json({ found: false });
      return;
    }

    const chapters = await fetchChapters(match.id);
    res.json({
      found: true,
      seriesId: match.id,
      title: match.title,
      chapters,
    });
  } catch (err) {
    console.error("[weebcentral] find error:", err);
    res.json({ found: false, error: true });
  }
});

router.get("/weebcentral/pages", async (req, res) => {
  const chapterId = String(req.query.chapterId ?? "").trim();
  if (!chapterId) {
    res.json({ pages: [] });
    return;
  }

  try {
    const pages = await fetchChapterPages(chapterId);
    res.json({ pages });
  } catch (err) {
    console.error("[weebcentral] pages error:", err);
    res.status(502).json({ pages: [], error: true });
  }
});

export default router;

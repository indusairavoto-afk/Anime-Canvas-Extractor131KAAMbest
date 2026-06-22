import { Router } from "express";

const router = Router();

const SEARCH_URL = "https://atsu.moe/collections/manga/documents/search";
const MANGA_BASE = "https://atsu.moe/manga";

interface AtsuChapter {
  id: string;
  number: number;
  title: string | null;
  pageCount: number;
  index: number;
}

interface AtsuSearchDoc {
  id: string;
  title: string;
  englishTitle?: string;
  chapterCount?: number;
}

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://atsu.moe",
  "Referer": "https://atsu.moe/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

async function searchAtsu(query: string, perPage = 5): Promise<AtsuSearchDoc[]> {
  const params = new URLSearchParams({
    q: query,
    query_by: "title,englishTitle,otherNames",
    per_page: String(perPage),
    include_fields: "id,title,englishTitle,chapterCount",
  });
  const res = await fetch(`${SEARCH_URL}?${params}`, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`atsu search HTTP ${res.status}`);
  const json = await res.json() as { hits?: { document: AtsuSearchDoc }[] };
  return (json.hits ?? []).map(h => h.document);
}

async function fetchChapters(mangaId: string): Promise<AtsuChapter[]> {
  const res = await fetch(`${MANGA_BASE}/${mangaId}`, {
    headers: {
      ...BROWSER_HEADERS,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": "https://atsu.moe/",
    },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const match = html.match(/window\.mangaPage\s*=\s*(\{.+?\});?\s*<\/script>/s);
  if (!match) return [];
  try {
    const data = JSON.parse(match[1]) as { mangaPage?: { chapters?: AtsuChapter[] } };
    const chapters = data.mangaPage?.chapters ?? [];
    return [...chapters].reverse();
  } catch {
    return [];
  }
}

function pickBestMatch(results: AtsuSearchDoc[], title: string): AtsuSearchDoc | null {
  if (!results.length) return null;
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = normalise(title);
  for (const r of results) {
    const t = normalise(r.englishTitle ?? r.title);
    if (t === target) return r;
  }
  for (const r of results) {
    const t = normalise(r.title);
    if (t === target) return r;
  }
  return results[0];
}

router.get("/atsu/find", async (req, res) => {
  const title = String(req.query.title ?? "").trim();
  if (!title) {
    res.json({ found: false });
    return;
  }

  try {
    let results = await searchAtsu(title, 5);
    let match = pickBestMatch(results, title);

    if (!match) {
      const shorter = title.split(":")[0].trim();
      if (shorter !== title) {
        results = await searchAtsu(shorter, 5);
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
      mangaId: match.id,
      title: match.englishTitle ?? match.title,
      chapters,
    });
  } catch (err) {
    console.error("[atsu] find error:", err);
    res.json({ found: false, error: true });
  }
});

export default router;

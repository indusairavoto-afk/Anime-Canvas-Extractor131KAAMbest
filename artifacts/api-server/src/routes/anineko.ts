import { Router } from "express";

const router = Router();
const ANINEKO = "https://anineko.to";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Referer": ANINEKO + "/",
};

function similarity(a: string, b: string): number {
  a = a.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  b = b.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (a === b) return 1;
  const aW = new Set(a.split(/\s+/).filter(Boolean));
  const bW = new Set(b.split(/\s+/).filter(Boolean));
  let common = 0;
  aW.forEach(w => { if (bW.has(w)) common++; });
  return aW.size + bW.size === 0 ? 0 : (2 * common) / (aW.size + bW.size);
}

/**
 * GET /api/anineko/find?title=&romajiTitle=&ep=
 *
 * Searches anineko.to for the anime, returns the slug + direct watch URL + first sub embed URL.
 * anineko.to is SSR PHP (HTTP 200 from our server), has no X-Frame-Options on watch pages.
 */
router.get("/anineko/find", async (req, res) => {
  const title = String(req.query.title || "");
  const romajiTitle = String(req.query.romajiTitle || "");
  const ep = Math.max(1, parseInt(String(req.query.ep || "1"), 10) || 1);
  const cachedSlug = String(req.query.slug || "");

  if (!title && !cachedSlug) return res.status(400).json({ error: "title required" });

  let bestSlug = cachedSlug;

  if (!bestSlug) {
    const queries = [title, romajiTitle].filter(Boolean);
    let bestScore = 0;

    for (const q of queries) {
      try {
        const r = await fetch(`${ANINEKO}/browser?keyword=${encodeURIComponent(q)}`, { headers: HEADERS });
        const html = await r.text();

        const re = /<h3 class="nv-anime-title"><a href="\/watch\/([^"]+)">([^<]+)<\/a><\/h3>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) !== null) {
          const slug = m[1].trim();
          const found = m[2].trim();
          const score = Math.max(similarity(found, title), romajiTitle ? similarity(found, romajiTitle) : 0);
          if (score > bestScore) {
            bestScore = score;
            bestSlug = slug;
          }
        }
      } catch (_) { /* continue */ }
      if (bestScore > 0.7) break;
    }

    if (!bestSlug) {
      return res.status(404).json({ error: "Anime not found on AniNeko" });
    }
  }

  const watchUrl = `${ANINEKO}/watch/${bestSlug}/ep-${ep}`;

  try {
    const wr = await fetch(watchUrl, { headers: HEADERS });
    if (!wr.ok) return res.status(404).json({ error: "Episode page not found", slug: bestSlug });
    const html = await wr.text();

    if (html.includes("Page Not Found")) {
      return res.status(404).json({ error: "Episode not available", slug: bestSlug });
    }

    // Extract first sub-tab embed URL. Sub panel is sandwiched between data-id="sub" and data-id="dub"
    let embedUrl = "";
    const subSection = html.match(/data-id="sub"([\s\S]*?)data-id="dub"/);
    if (subSection) {
      const m = subSection[1].match(/data-video="([^"]+)"/);
      if (m) embedUrl = m[1];
    }
    if (!embedUrl) {
      const m = html.match(/data-video="([^"]+)"/);
      if (m) embedUrl = m[1];
    }

    return res.json({ slug: bestSlug, watchUrl, embedUrl });
  } catch (e) {
    return res.status(502).json({ error: "Failed to load episode page" });
  }
});

export default router;

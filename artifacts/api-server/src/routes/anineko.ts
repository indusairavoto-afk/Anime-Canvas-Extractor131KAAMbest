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
  if (a.includes(b) || b.includes(a)) return 0.85;
  // Fused title match: "marriagetoxin" vs "marriage toxin"
  const aFused = a.replace(/\s+/g, "");
  const bFused = b.replace(/\s+/g, "");
  if (aFused === bFused) return 0.95;
  if (aFused.includes(bFused) || bFused.includes(aFused)) return 0.82;
  const aW = new Set(a.split(/\s+/).filter(Boolean));
  const bW = new Set(b.split(/\s+/).filter(Boolean));
  let common = 0;
  aW.forEach(w => { if (bW.has(w)) common++; });
  return aW.size + bW.size === 0 ? 0 : (2 * common) / (aW.size + bW.size);
}

function titleVariants(t: string): string[] {
  const variants: string[] = [t];

  // No spaces (for fused titles like "marriagetoxin")
  const noSpace = t.replace(/\s+/g, "");
  if (noSpace !== t) variants.push(noSpace);

  // Strip season/part markers
  const stripped = t
    .replace(/\b(season|part|cour|arc)\s*\d+\b/gi, "")
    .replace(/\b\d+(st|nd|rd|th)\s*(season|cour|part)\b/gi, "")
    .replace(/\b(i{2,3}|iv|vi{0,3}|ix|xi{0,3})\b/gi, "")  // roman numerals II-XIII
    .replace(/\s{2,}/g, " ").trim();
  if (stripped && stripped !== t) variants.push(stripped);

  // First 4 / 3 / 2 words
  const words = t.split(/\s+/);
  if (words.length > 4) variants.push(words.slice(0, 4).join(" "));
  if (words.length > 3) variants.push(words.slice(0, 3).join(" "));
  if (words.length > 2) variants.push(words.slice(0, 2).join(" "));

  // Remove all punctuation
  const noPunct = t.replace(/[^\w\s]/g, " ").replace(/\s{2,}/g, " ").trim();
  if (noPunct !== t) variants.push(noPunct);

  return [...new Set(variants)]; // deduplicate
}

async function searchAnineko(queries: string[]): Promise<{ slug: string; score: number } | null> {
  let best: { slug: string; score: number } | null = null;

  for (const baseQuery of queries) {
    const variants = titleVariants(baseQuery);
    for (const q of variants) {
      if (!q || q.length < 2) continue;
      try {
        const r = await fetch(`${ANINEKO}/browser?keyword=${encodeURIComponent(q)}`, { headers: HEADERS });
        const html = await r.text();

        const re = /<h3 class="nv-anime-title"><a href="\/watch\/([^"]+)">([^<]+)<\/a><\/h3>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) !== null) {
          const slug = m[1].trim();
          const found = m[2].trim();
          const score = Math.max(
            ...queries.flatMap(orig => [
              similarity(found, orig),
              similarity(found, orig.replace(/[^\w\s]/g, " ").trim()),
            ])
          );
          if (!best || score > best.score) {
            best = { slug, score };
          }
        }
      } catch (_) { /* continue */ }
      if (best && best.score >= 0.85) return best; // early exit on strong match
    }
    if (best && best.score >= 0.6) break; // good enough after first query set
  }

  return best && best.score >= 0.45 ? best : null;
}

/**
 * GET /api/anineko/find?title=&romajiTitle=&ep=&slug=
 *
 * Searches anineko.to for the anime, returns the slug + direct watch URL + sub embed URL.
 * anineko.to watch pages have no X-Frame-Options.
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
    const result = await searchAnineko(queries);
    if (!result) {
      return res.status(404).json({ error: "Anime not found on AniNeko" });
    }
    bestSlug = result.slug;
  }

  const watchUrl = `${ANINEKO}/watch/${bestSlug}/ep-${ep}`;

  try {
    const wr = await fetch(watchUrl, { headers: HEADERS });
    if (!wr.ok) return res.status(404).json({ error: "Episode page not found", slug: bestSlug });
    const html = await wr.text();

    if (html.includes("Page Not Found")) {
      return res.status(404).json({ error: "Episode not available on AniNeko", slug: bestSlug });
    }

    // Extract first sub-tab embed URL
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
    return res.status(502).json({ error: "Failed to load AniNeko episode page" });
  }
});

export default router;

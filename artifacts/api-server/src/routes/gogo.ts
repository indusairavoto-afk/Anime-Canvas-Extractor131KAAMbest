import { Router } from "express";

const router = Router();

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "identity",
  "Cache-Control": "no-cache",
};

function normalizeUrl(url: string): string {
  url = url.trim();
  if (url.startsWith("//")) return "https:" + url;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return "https://" + url;
  return url;
}

function extractCdnUrl(html: string): string | null {
  const m1 = html.match(/data-video=["']([^"']+)["']/);
  if (m1?.[1]) {
    const raw = m1[1];
    if (raw.startsWith("http") || raw.startsWith("//")) return normalizeUrl(raw);
    const decoded = raw
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const srcM = decoded.match(/src=["']([^"']+)["']/);
    if (srcM?.[1]) return normalizeUrl(srcM[1]);
  }
  const m2 = html.match(/(?:var\s+link|link\s*=)\s*["']([^"']*streaming[^"']*)["']/i);
  if (m2?.[1]) return normalizeUrl(m2[1]);
  const m3 = html.match(
    /<iframe[^>]+src=["']([^"']*(?:streaming|embed|gogoplay|embtaku|vidstreaming|gogo-stream)[^"']*)["'][^>]*>/i,
  );
  if (m3?.[1]) return normalizeUrl(m3[1]);
  const m4 = html.match(
    /<iframe[^>]+src=["']((?:https?:)?\/\/(?!(?:www\.)?gogoanimes)[^"']+)["'][^>]*>/i,
  );
  if (m4?.[1]) return normalizeUrl(m4[1]);
  return null;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#0*38;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function extractInnerPlayerUrl(streamingUrl: string): Promise<string | null> {
  try {
    const cleanUrl = decodeHtmlEntities(streamingUrl);
    const resp = await fetch(cleanUrl, {
      headers: {
        ...BROWSER_HEADERS,
        Referer: "https://gogoanimes.cv/",
      },
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const m = html.match(/<iframe[^>]*?\bsrc=["']([^"']+)["'][^>]*>/i);
    if (m?.[1]) return normalizeUrl(m[1]);
    return null;
  } catch {
    return null;
  }
}

function toOrdinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

function slugVariants(slug: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (s: string) => {
    s = s.trim().replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  };

  add(slug);

  // Season number permutations
  const snm = slug.match(/(?:^|-)season-(\d+)(?:-|$)/i);
  if (snm) {
    const n = parseInt(snm[1]);
    const ord = toOrdinal(n);
    add(slug.replace(`season-${n}`, `${ord}-season`));
    add(slug.replace(`-season-${n}`, `-${ord}-season`));
    add(slug.replace(new RegExp(`-?season-${n}`, "i"), ""));
    add(slug.replace(new RegExp(`-?season-${n}`, "i"), `-${n}`));
    // e.g. "attack-on-titan-season-4" → "shingeki-no-kyojin-the-final-season" won't be caught here
    // but we cover the structural variants
    add(slug.replace(new RegExp(`-?season-${n}`, "i"), `-part-${n}`));
  }

  const osm = slug.match(/(\d+)(?:st|nd|rd|th)-season/i);
  if (osm) {
    const n = osm[1];
    add(slug.replace(osm[0], `season-${n}`));
    add(slug.replace(osm[0], "").replace(/-+/g, "-").replace(/^-|-$/g, ""));
  }

  // Strip suffixes
  add(slug.replace(/-part-\d+/i, ""));
  add(slug.replace(/-cour-\d+/i, ""));
  add(slug.replace(/-\d{4}$/, ""));
  add(slug.replace(/-(?:season|part|cour)-\d+$/i, ""));

  // TV suffix
  add(slug + "-tv");
  add(slug.replace(/-tv$/i, ""));

  // "re:" prefix variants
  if (slug.startsWith("re-")) add("re" + slug.slice(3));
  if (slug.startsWith("re") && !slug.startsWith("re-")) add("re-" + slug.slice(2));

  // "the" prefix removal/addition
  if (slug.startsWith("the-")) add(slug.slice(4));
  if (!slug.startsWith("the-")) add("the-" + slug);

  // Type suffix stripping
  add(slug.replace(/-dub$/i, ""));
  add(slug.replace(/-(ova|ona|movie|special)$/i, ""));

  // "wo" → "o" (Japanese particle romanisation, e.g. "overlord-wo" → "overlord-o")
  add(slug.replace(/-wo-/g, "-o-").replace(/-wo$/g, ""));

  // ": " → "-" already done by title normalisation, but try collapsing hyphens differently
  add(slug.replace(/--+/g, "-"));

  // Common GoGo year suffix
  add(slug.replace(/-\d{4}(-\d+)?$/, ""));

  return out;
}

/** Normalise a title to a GoGo-style slug for deriving candidates. */
export function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Simple title similarity score (0–1). */
function titleSimilarity(a: string, b: string): number {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
  const an = norm(a);
  const bn = norm(b);
  if (an === bn) return 1;
  if (an.includes(bn) || bn.includes(an)) return 0.8;
  const aWords = new Set(an.split(" "));
  const bWords = bn.split(" ");
  const overlap = bWords.filter((w) => aWords.has(w)).length;
  return overlap / Math.max(aWords.size, bWords.length);
}

/** Score a GoGo search result title against the query. Returns a number — higher is better. */
function scoreResult(resultTitle: string, query: string): number {
  const SPINOFF_WORDS = ["rewrite", "movie", "film", "special", "ova", "recap", "compilation", "live action", "live-action"];
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
  const qNorm = norm(query);
  const tNorm = norm(resultTitle);

  let score = 0;
  if (tNorm === qNorm) {
    score = 1000;
  } else if (tNorm.startsWith(qNorm)) {
    score = 500 - (tNorm.length - qNorm.length) * 3;
  } else if (tNorm.includes(qNorm)) {
    score = 200 - (tNorm.length - qNorm.length) * 2;
  } else {
    const qWords = qNorm.split(" ");
    const tWords = new Set(tNorm.split(" "));
    const overlap = qWords.filter((w) => tWords.has(w)).length;
    score = overlap > 0 ? (overlap / qWords.length) * 80 - 50 : -999;
  }

  for (const word of SPINOFF_WORDS) {
    if (tNorm.includes(word) && !qNorm.includes(word)) score -= 400;
  }

  return score;
}

interface ProbedResult {
  cdnUrl: string;
  slug: string;
  pageTitle: string | null;
}

async function probeCdnUrl(slug: string, ep: string): Promise<ProbedResult | null> {
  const pageUrl = `https://gogoanimes.cv/${slug}-episode-${ep}/`;
  try {
    const upstream = await fetch(pageUrl, {
      headers: { ...BROWSER_HEADERS, Referer: "https://gogoanimes.cv/", Host: "gogoanimes.cv" },
    });
    if (!upstream.ok) return null;
    const html = await upstream.text();

    // Extract page title for episode verification
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch?.[1]?.trim().replace(/\s+/g, " ") ?? null;

    const streamingUrl = extractCdnUrl(html);
    if (!streamingUrl) return null;

    const innerUrl = await extractInnerPlayerUrl(streamingUrl);
    return { cdnUrl: innerUrl ?? decodeHtmlEntities(streamingUrl), slug, pageTitle };
  } catch {
    return null;
  }
}

/** Search gogoanimes.cv and return scored results. */
async function searchGogo(q: string, limit = 10): Promise<{ slug: string; title: string; thumbnail: string }[]> {
  const searchUrl = `https://gogoanimes.cv/?s=${encodeURIComponent(q)}`;
  try {
    const upstream = await fetch(searchUrl, {
      headers: { ...BROWSER_HEADERS, Referer: "https://gogoanimes.cv/", Host: "gogoanimes.cv" },
    });
    if (!upstream.ok) return [];
    const html = await upstream.text();

    const results: { slug: string; title: string; thumbnail: string }[] = [];
    const seen = new Set<string>();

    const blockRe =
      /<a\s+href="https?:\/\/gogoanimes\.cv\/anime\/([^/"]+)\/"\s+title="([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(html)) !== null && results.length < limit) {
      const slug = m[1].trim();
      const title = m[2].trim().replace(/\s*\(\d{4}\)\s*$/, "");
      const thumbnail = m[3].trim();
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      results.push({ slug, title, thumbnail });
    }

    if (results.length === 0) {
      const hrefRe = /href="https?:\/\/gogoanimes\.cv\/anime\/([^/"]+)\/"\s+title="([^"]+)"/gi;
      while ((m = hrefRe.exec(html)) !== null && results.length < limit) {
        const slug = m[1].trim();
        const title = m[2].trim().replace(/\s*\(\d{4}\)\s*$/, "");
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        results.push({ slug, title, thumbnail: "" });
      }
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * GET /api/gogo/cdn-url?slug=...&ep=...
 * Tries slug + auto-generated variants until one works.
 * Returns: { cdnUrl, resolvedSlug, pageTitle, triedVariants }
 */
router.get("/gogo/cdn-url", async (req, res) => {
  const slug = req.query.slug as string | undefined;
  const ep = req.query.ep as string | undefined;
  if (!slug || !ep) return res.status(400).json({ error: "slug and ep query params are required" });

  const variants = slugVariants(slug);
  for (const variant of variants) {
    const result = await probeCdnUrl(variant, ep);
    if (result) {
      return res.json({
        cdnUrl: result.cdnUrl,
        resolvedSlug: result.slug,
        pageTitle: result.pageTitle,
        triedVariants: variants.indexOf(variant) + 1,
      });
    }
  }
  return res.status(404).json({ error: "No working slug found after trying all variants", triedVariants: variants });
});

/**
 * GET /api/gogo/resolve-slug?title=...&ep=...
 *
 * Full auto-resolution: derives slug from title → tries variants → if all fail,
 * searches GoGo for the title and picks the best scoring match → probes that slug.
 * This lets the frontend make a single call instead of a two-step derive + search.
 */
router.get("/gogo/resolve-slug", async (req, res) => {
  const titleRaw = (req.query.title as string | undefined)?.trim();
  const ep = (req.query.ep as string | undefined)?.trim();
  if (!titleRaw || !ep) return res.status(400).json({ error: "title and ep query params are required" });

  // Step 1: derive and try slug variants
  const derived = titleToSlug(titleRaw);
  const variants = slugVariants(derived);

  for (const variant of variants) {
    const result = await probeCdnUrl(variant, ep);
    if (result) {
      return res.json({
        cdnUrl: result.cdnUrl,
        resolvedSlug: result.slug,
        pageTitle: result.pageTitle,
        method: "variant",
        triedVariants: variants.indexOf(variant) + 1,
      });
    }
  }

  // Step 2: search GoGo by title and pick best match
  const searchQuery = titleRaw
    .replace(/\s*season\s*\d+/i, "")
    .replace(/\s*\d+(st|nd|rd|th)\s*season/i, "")
    .trim();

  const searchResults = await searchGogo(searchQuery, 8);

  if (searchResults.length === 0) {
    return res.status(404).json({ error: "No results found on GogoAnimes", method: "search" });
  }

  // Score and sort
  const scored = searchResults
    .map((r) => ({ ...r, score: scoreResult(r.title, searchQuery) }))
    .sort((a, b) => b.score - a.score);

  // Try slugs in score order
  for (const candidate of scored) {
    if (candidate.score < 0) continue;
    const candidateVariants = slugVariants(candidate.slug);
    for (const variant of candidateVariants) {
      const result = await probeCdnUrl(variant, ep);
      if (result) {
        return res.json({
          cdnUrl: result.cdnUrl,
          resolvedSlug: result.slug,
          pageTitle: result.pageTitle,
          method: "search",
          searchQuery,
          matchedTitle: candidate.title,
          matchScore: candidate.score,
        });
      }
    }
  }

  return res.status(404).json({
    error: "Could not find a working stream after searching",
    method: "search",
    searchResults: scored.slice(0, 5).map((r) => ({ slug: r.slug, title: r.title, score: r.score })),
  });
});

/**
 * GET /api/gogo/search?q=...&limit=10
 */
router.get("/gogo/search", async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  const limit = Math.min(parseInt((req.query.limit as string) || "10"), 20);
  if (!q) return res.status(400).json({ error: "q query param required" });

  try {
    const results = await searchGogo(q, limit);
    return res.json({ results, query: q, total: results.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.status(502).json({ error: msg, results: [] });
  }
});

/**
 * GET /api/gogo/check-slug?slug=...
 */
router.get("/gogo/check-slug", async (req, res) => {
  const slug = req.query.slug as string | undefined;
  if (!slug) return res.status(400).json({ error: "slug param required" });
  try {
    const r = await fetch(`https://gogoanimes.cv/${slug}/`, {
      method: "HEAD",
      headers: { ...BROWSER_HEADERS, Referer: "https://gogoanimes.cv/", Host: "gogoanimes.cv" },
    });
    return res.json({ exists: r.ok, status: r.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.status(502).json({ error: msg });
  }
});

export { titleSimilarity, scoreResult };
export default router;

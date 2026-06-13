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

  const snm = slug.match(/(?:^|-)season-(\d+)(?:-|$)/i);
  if (snm) {
    const n = parseInt(snm[1]);
    const ord = toOrdinal(n);
    add(slug.replace(`season-${n}`, `${ord}-season`));
    add(slug.replace(`-season-${n}`, `-${ord}-season`));
    add(slug.replace(new RegExp(`-?season-${n}`, "i"), ""));
    add(slug.replace(new RegExp(`-?season-${n}`, "i"), `-${n}`));
  }

  const osm = slug.match(/(\d+)(?:st|nd|rd|th)-season/i);
  if (osm) {
    const n = osm[1];
    add(slug.replace(osm[0], `season-${n}`));
    add(slug.replace(osm[0], "").replace(/-+/g, "-").replace(/^-|-$/g, ""));
  }

  add(slug.replace(/-part-\d+/i, ""));
  add(slug.replace(/-cour-\d+/i, ""));
  add(slug.replace(/-\d{4}$/, ""));
  add(slug + "-tv");
  add(slug.replace(/-tv$/i, ""));
  if (slug.startsWith("re-")) add("re" + slug.slice(3));
  if (slug.startsWith("re") && !slug.startsWith("re-")) add("re-" + slug.slice(2));
  if (slug.startsWith("the-")) add(slug.slice(4));
  add(slug.replace(/-dub$/i, ""));
  add(slug.replace(/-(ova|ona|movie|special)$/i, ""));

  return out;
}

async function probeCdnUrl(slug: string, ep: string): Promise<{ cdnUrl: string; slug: string } | null> {
  const pageUrl = `https://gogoanimes.cv/${slug}-episode-${ep}/`;
  try {
    const upstream = await fetch(pageUrl, {
      headers: { ...BROWSER_HEADERS, Referer: "https://gogoanimes.cv/", Host: "gogoanimes.cv" },
    });
    if (!upstream.ok) return null;
    const html = await upstream.text();
    const cdnUrl = extractCdnUrl(html);
    if (!cdnUrl) return null;
    return { cdnUrl, slug };
  } catch {
    return null;
  }
}

/**
 * GET /api/gogo/cdn-url?slug=...&ep=...
 * Tries slug + auto-generated variants until one works.
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
        triedVariants: variants.indexOf(variant) + 1,
      });
    }
  }
  return res.status(404).json({ error: "No working slug found after trying all variants", triedVariants: variants });
});

/**
 * GET /api/gogo/search?q=...&limit=10
 * Searches gogoanimes.cv for anime matching the query.
 * Returns [{ slug, title, thumbnail }]
 *
 * gogoanimes.cv is a WordPress site — search is via /?s=QUERY.
 * Anime page URLs are /anime/SLUG/ — the slug matches episode URLs /SLUG-episode-N/.
 */
router.get("/gogo/search", async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  const limit = Math.min(parseInt((req.query.limit as string) || "10"), 20);
  if (!q) return res.status(400).json({ error: "q query param required" });

  const searchUrl = `https://gogoanimes.cv/?s=${encodeURIComponent(q)}`;
  try {
    const upstream = await fetch(searchUrl, {
      headers: {
        ...BROWSER_HEADERS,
        Referer: "https://gogoanimes.cv/",
        Host: "gogoanimes.cv",
      },
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `gogoanimes.cv returned ${upstream.status}`, results: [] });
    }

    const html = await upstream.text();

    // Each result: <a href="https://gogoanimes.cv/anime/SLUG/" title="TITLE">
    //                <img src="THUMBNAIL" alt="TITLE">
    //              </a>
    const results: { slug: string; title: string; thumbnail: string }[] = [];
    const seen = new Set<string>();

    // Match anchor tags pointing to /anime/ pages with a title attr + child img
    const blockRe =
      /<a\s+href="https?:\/\/gogoanimes\.cv\/anime\/([^/"]+)\/"\s+title="([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(html)) !== null && results.length < limit) {
      const slug = m[1].trim();
      const title = m[2].trim().replace(/\s*\(\d{4}\)\s*$/, ""); // strip trailing year e.g. "(2020)"
      const thumbnail = m[3].trim();
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      results.push({ slug, title, thumbnail });
    }

    // Fallback: just extract /anime/ hrefs if no thumbnails matched
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

    return res.json({ results, query: q, total: results.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.status(502).json({ error: msg, results: [] });
  }
});

/**
 * GET /api/gogo/check-slug?slug=...
 * Quick existence check for a slug.
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

export default router;

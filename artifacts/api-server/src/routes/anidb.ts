import { Router } from "express";

const router = Router();

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "identity",
  "Cache-Control": "no-cache",
};

/**
 * GET /api/anidb/search?q=...&limit=10
 * Searches anidb.app for anime matching the query.
 * Returns [{ slug, title, thumbnail }]
 */
router.get("/anidb/search", async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  const limit = Math.min(parseInt((req.query.limit as string) || "10"), 20);
  if (!q) return res.status(400).json({ error: "q query param required" });

  const searchUrl = `https://anidb.app/anime?search=${encodeURIComponent(q)}`;

  try {
    const upstream = await fetch(searchUrl, {
      headers: {
        ...BROWSER_HEADERS,
        Referer: "https://anidb.app/",
        Host: "anidb.app",
      },
    });

    if (!upstream.ok) {
      // Cloudflare blocks often come back as 403 or 503
      const isCloudflare = upstream.status === 403 || upstream.status === 503 || upstream.status === 429;
      return res.json({ results: [], blocked: isCloudflare, query: q });
    }

    const html = await upstream.text();

    // Detect Cloudflare challenge page
    if (
      html.includes("Just a moment") ||
      html.includes("_cf_chl_opt") ||
      html.includes("Enable JavaScript and cookies")
    ) {
      return res.json({ results: [], blocked: true, query: q });
    }

    const results: { slug: string; title: string; thumbnail: string }[] = [];
    const seen = new Set<string>();

    // Match anime card links: href="/anime/slug-name"
    // Typical pattern on anidb.app: <a href="/anime/slug"> with nearby title and img
    const blockRe =
      /<a[^>]+href="\/anime\/([^"/?#]+)"[^>]*>[\s\S]*?(?:<img[^>]+(?:src|data-src)="([^"]*)"[^>]*>[\s\S]*?)?<[^>]*class="[^"]*(?:title|name)[^"]*"[^>]*>([^<]*)</gi;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(html)) !== null && results.length < limit) {
      const slug = m[1].trim();
      const thumbnail = (m[2] ?? "").trim();
      const title = (m[3] ?? "").trim();
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      results.push({ slug, title: title || slug, thumbnail });
    }

    // Fallback: just collect slugs from href="/anime/..."
    if (results.length === 0) {
      const hrefRe = /href="\/anime\/([^"/?#]+)"/gi;
      let m2: RegExpExecArray | null;
      while ((m2 = hrefRe.exec(html)) !== null && results.length < limit) {
        const slug = m2[1].trim();
        if (!slug || seen.has(slug) || slug === "list" || slug === "search") continue;
        seen.add(slug);
        results.push({ slug, title: slug, thumbnail: "" });
      }
    }

    return res.json({ results, blocked: false, query: q, total: results.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.status(502).json({ error: msg, results: [], blocked: false });
  }
});

export default router;

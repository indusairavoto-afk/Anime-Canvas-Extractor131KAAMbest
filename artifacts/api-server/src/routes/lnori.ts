import { Router } from "express";

const router = Router();

const LNORI_ORIGIN = "https://lnori.com";
const PASS_PREFIX = "/api/lnori/pass";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const BLOCKED_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "content-length",
  "transfer-encoding",
]);

const READER_STYLE = `<style id="na-lnori-override">
header:not(.toc-sidebar-header),
nav:not(.toc-view),
.top-bar, .site-header, .site-nav,
#top-bar, #site-header, #navbar,
[class*="topbar"], [class*="top-nav"],
[class*="cookie"], [class*="banner"][class*="ad"],
[class*="advertisement"], [class*="popup"] {
  display: none !important;
}

html, body {
  background: #0a0a0a !important;
  margin: 0 !important;
  padding: 0 !important;
  color: #e8e8e8 !important;
  font-family: Georgia, 'Times New Roman', serif !important;
}

#sidebar-container .toc-sidebar {
  background: #111 !important;
  border-right: 1px solid rgba(255,255,255,0.06) !important;
  color: #bbb !important;
}
.toc-sidebar-header {
  background: #111 !important;
  border-bottom: 1px solid rgba(255,255,255,0.06) !important;
  padding: 12px 16px !important;
}
#book-title {
  font-size: 13px !important;
  font-family: Georgia, serif !important;
  color: #ddd !important;
  line-height: 1.4 !important;
}
#book-author {
  font-size: 11px !important;
  font-family: monospace !important;
  color: #666 !important;
  font-style: normal !important;
  margin-top: 4px !important;
}
.toc-view li a {
  color: #888 !important;
  font-size: 12px !important;
  font-family: monospace !important;
  text-decoration: none !important;
  display: block !important;
  padding: 6px 16px !important;
  border-left: 2px solid transparent !important;
  transition: color 0.15s, border-color 0.15s !important;
}
.toc-view li a:hover,
.toc-view li a.active {
  color: #fff !important;
  border-left-color: rgba(255,255,255,0.3) !important;
  background: rgba(255,255,255,0.04) !important;
}

.chapter, [class*="chapter-content"] {
  color: #d8d8d8 !important;
  line-height: 1.85 !important;
  font-size: 16px !important;
  max-width: 700px !important;
  margin: 0 auto !important;
  padding: 24px 16px !important;
}
.chapter-title {
  color: #fff !important;
  font-size: 18px !important;
  font-family: Georgia, serif !important;
  margin-bottom: 16px !important;
}
.chapter-separator {
  border-color: rgba(255,255,255,0.08) !important;
  margin: 32px 0 !important;
}
img {
  max-width: 100% !important;
  height: auto !important;
  display: block !important;
  margin: 16px auto !important;
  border: 1px solid rgba(255,255,255,0.08) !important;
}
p { color: #d0d0d0 !important; }
a { color: #888 !important; }
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-track { background: #0a0a0a; }
::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #3a3a3a; }
</style>`;

function rewriteHtmlUrls(html: string): string {
  return html
    .replace(new RegExp(`${LNORI_ORIGIN}/`, "g"), `${PASS_PREFIX}/`)
    .replace(/(src|href|action)="\/(?!\/|api\/lnori\/)/g, `$1="${PASS_PREFIX}/`)
    .replace(/(src|href|action)='\/(?!\/|api\/lnori\/)/g, `$1='${PASS_PREFIX}/`)
    .replace(/url\(\/(?!\/|api\/lnori\/)/g, `url(${PASS_PREFIX}/`);
}

function injectIntoHtml(html: string, injection: string): string {
  if (html.includes("</head>")) {
    return html.replace("</head>", injection + "</head>");
  }
  if (html.includes("<head>")) {
    return html.replace("<head>", "<head>" + injection);
  }
  return injection + html;
}

/** Derive a human-readable label from a lnori.com book slug. */
function labelFromSlug(slug: string): string {
  const volMatch = slug.match(/-vol-(\d+(?:\.\d+)?)$/i);
  if (volMatch) return `Vol. ${volMatch[1]}`;
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

/** Parse all unique book links from a lnori.com series or library page. */
function parseBookLinks(html: string): { bookId: string; slug: string; label: string }[] {
  const seen = new Set<string>();
  const results: { bookId: string; slug: string; label: string }[] = [];
  const re = /href="\/book\/(\d+)\/([^"?#]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const bookId = m[1];
    if (seen.has(bookId)) continue;
    seen.add(bookId);
    const slug = m[2];
    results.push({ bookId, slug, label: labelFromSlug(slug) });
  }
  return results;
}

/* ── Pass-through proxy ─────────────────────────────────────────────────── */

router.all("/lnori/pass/*path", async (req, res) => {
  const rawPath = (req.params as Record<string, string | string[]>).path;
  const rest = (Array.isArray(rawPath) ? rawPath.join("/") : rawPath ?? "").replace(/^\//, "");
  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const upstreamUrl = `${LNORI_ORIGIN}/${rest}${search}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        ...HEADERS,
        Origin: LNORI_ORIGIN,
        Referer: LNORI_ORIGIN + "/",
        ...(req.headers["cookie"] ? { Cookie: req.headers["cookie"] as string } : {}),
      },
      signal: AbortSignal.timeout(15000),
    });

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=86400");

    for (const [key, value] of upstream.headers.entries()) {
      if (!BLOCKED_HEADERS.has(key.toLowerCase()) && key.toLowerCase() !== "content-type") {
        try { res.setHeader(key, value); } catch { /* skip invalid headers */ }
      }
    }

    res.status(upstream.status);
    const buf = await upstream.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err: unknown) {
    req.log?.error(err);
    res.status(502).json({ error: "lnori pass proxy error" });
  }
});

/* ── Book reader ────────────────────────────────────────────────────────── */

router.get("/lnori/reader", async (req, res) => {
  const bookId = typeof req.query.bookId === "string" ? req.query.bookId.trim() : "";
  const slug = typeof req.query.slug === "string" ? req.query.slug.trim() : "";
  const page = typeof req.query.page === "string" ? req.query.page.trim() : "";

  if (!bookId || !slug) {
    res.status(400).json({ error: "bookId and slug are required" });
    return;
  }

  const bookPath = `/book/${bookId}/${slug}`;
  const upstreamUrl = `${LNORI_ORIGIN}${bookPath}${page ? `#${page}` : ""}`;

  try {
    const upstream = await fetch(`${LNORI_ORIGIN}${bookPath}`, {
      headers: { ...HEADERS, Referer: LNORI_ORIGIN + "/" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });

    if (!upstream.ok) {
      res.status(upstream.status).send(
        `<html><body style="background:#0a0a0a;color:#888;font-family:monospace;padding:2rem">
          <p>lnori.com returned ${upstream.status} for ${bookPath}</p>
        </body></html>`
      );
      return;
    }

    let html = await upstream.text();
    html = rewriteHtmlUrls(html);
    html = injectIntoHtml(html, READER_STYLE);

    if (page) {
      const scrollScript = `<script>(function(){function go(){var el=document.getElementById(${JSON.stringify(page)});if(el)el.scrollIntoView({behavior:'smooth'});}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',go);}else{setTimeout(go,200);}}());</script>`;
      html = injectIntoHtml(html, scrollScript);
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Lnori-Url", upstreamUrl);
    res.send(html);
  } catch (err: unknown) {
    req.log?.error(err);
    res.status(502).send(
      `<html><body style="background:#0a0a0a;color:#888;font-family:monospace;padding:2rem">
        <p>Failed to load novel from lnori.com. Please try again.</p>
      </body></html>`
    );
  }
});

/* ── Book TOC ───────────────────────────────────────────────────────────── */

router.get("/lnori/toc", async (req, res) => {
  const bookId = typeof req.query.bookId === "string" ? req.query.bookId.trim() : "";
  const slug = typeof req.query.slug === "string" ? req.query.slug.trim() : "";

  if (!bookId || !slug) {
    res.status(400).json({ error: "bookId and slug are required" });
    return;
  }

  try {
    const upstream = await fetch(`${LNORI_ORIGIN}/book/${bookId}/${slug}`, {
      headers: { ...HEADERS, Referer: LNORI_ORIGIN + "/" },
      signal: AbortSignal.timeout(20000),
    });

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `lnori returned ${upstream.status}` });
      return;
    }

    const html = await upstream.text();

    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const bookTitle = titleMatch ? titleMatch[1].trim() : "";

    const tocMatch = html.match(/<nav[^>]*toc-view[^>]*>([\s\S]*?)<\/nav>/i);
    const tocEntries: { anchor: string; label: string }[] = [];

    if (tocMatch) {
      const tocHtml = tocMatch[1];
      const linkRe = /<a[^>]+href="(#[^"]+)"[^>]*>([^<]+)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(tocHtml)) !== null) {
        tocEntries.push({
          anchor: m[1].replace(/^#/, ""),
          label: m[2].trim(),
        });
      }
    }

    res.json({ bookTitle, entries: tocEntries });
  } catch (err: unknown) {
    req.log?.error(err);
    res.status(502).json({ error: "Failed to fetch TOC from lnori.com" });
  }
});

/* ── Series volumes ─────────────────────────────────────────────────────── */

/**
 * GET /api/lnori/series?seriesId=<id>&slug=<slug>
 *
 * Fetches a lnori.com series page and returns all volumes as JSON.
 * Returns { seriesTitle, volumes: [{bookId, slug, label}] }
 */
router.get("/lnori/series", async (req, res) => {
  const seriesId = typeof req.query.seriesId === "string" ? req.query.seriesId.trim() : "";
  const slug = typeof req.query.slug === "string" ? req.query.slug.trim() : "";

  if (!seriesId || !slug) {
    res.status(400).json({ error: "seriesId and slug are required" });
    return;
  }

  try {
    const upstream = await fetch(`${LNORI_ORIGIN}/series/${seriesId}/${slug}`, {
      headers: { ...HEADERS, Referer: LNORI_ORIGIN + "/" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `lnori returned ${upstream.status}` });
      return;
    }

    const html = await upstream.text();

    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const seriesTitle = titleMatch
      ? titleMatch[1].replace(/\s*[-|].*$/, "").trim()
      : slug.replace(/-/g, " ");

    const volumes = parseBookLinks(html);

    res.json({ seriesTitle, volumes });
  } catch (err: unknown) {
    req.log?.error(err);
    res.status(502).json({ error: "Failed to fetch series from lnori.com" });
  }
});

/* ── Find novel ─────────────────────────────────────────────────────────── */

/**
 * GET /api/lnori/find?anilistId=<id>&title=<title>&lnoriUrl=<url>
 *
 * Priority:
 *  1. If lnoriUrl is given, parse it directly (book or series).
 *  2. Check AniList externalLinks for book or series URLs.
 *  3. Fall back to "not found" with a search link.
 */
router.get("/lnori/find", async (req, res) => {
  const anilistId = typeof req.query.anilistId === "string" ? req.query.anilistId.trim() : "";
  const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
  const lnoriUrl = typeof req.query.lnoriUrl === "string" ? req.query.lnoriUrl.trim() : "";

  // 1. Direct lnori URL provided — parse it
  if (lnoriUrl) {
    const seriesMatch = lnoriUrl.match(/lnori\.com\/series\/(\d+)\/([^/?#]+)/);
    if (seriesMatch) {
      res.json({ found: true, type: "series", seriesId: seriesMatch[1], slug: seriesMatch[2] });
      return;
    }
    const bookMatch = lnoriUrl.match(/lnori\.com\/book\/(\d+)\/([^/?#]+)/);
    if (bookMatch) {
      res.json({ found: true, type: "book", bookId: bookMatch[1], slug: bookMatch[2] });
      return;
    }
  }

  // 2. Check AniList externalLinks
  if (anilistId) {
    try {
      const anilistRes = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `query($id:Int!){Media(id:$id,type:MANGA){externalLinks{url site}}}`,
          variables: { id: Number(anilistId) },
        }),
        signal: AbortSignal.timeout(10000),
      });
      const anilistData = await anilistRes.json();
      const links: { url: string; site: string }[] =
        anilistData?.data?.Media?.externalLinks ?? [];

      for (const link of links) {
        const seriesMatch = link.url.match(/lnori\.com\/series\/(\d+)\/([^/?#]+)/);
        if (seriesMatch) {
          res.json({ found: true, type: "series", seriesId: seriesMatch[1], slug: seriesMatch[2] });
          return;
        }
        const bookMatch = link.url.match(/lnori\.com\/book\/(\d+)\/([^/?#]+)/);
        if (bookMatch) {
          res.json({ found: true, type: "book", bookId: bookMatch[1], slug: bookMatch[2] });
          return;
        }
      }
    } catch {
      // fall through
    }
  }

  const searchUrl = `https://lnori.com/library#search`;
  res.json({ found: false, searchUrl });
});

export default router;

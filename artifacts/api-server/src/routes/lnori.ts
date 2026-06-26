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

/**
 * CSS injected into the proxied lnori.com reader page.
 * Hides the top navigation bar and adjusts the sidebar to match our dark theme.
 */
const READER_STYLE = `<style id="na-lnori-override">
/* Hide top nav / site branding */
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

/* Sidebar / TOC */
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

/* Main reading area */
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

/**
 * Rewrite lnori.com absolute and root-relative URLs to go through our pass proxy.
 */
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

/**
 * ALL /api/lnori/pass/*path
 *
 * Pass-through proxy for all lnori.com assets (CSS, JS, images, fonts).
 */
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

/**
 * GET /api/lnori/reader?bookId=<id>&slug=<slug>&page=<pageAnchor>
 *
 * Fetches a lnori.com book page, rewrites asset URLs to go through the pass
 * proxy, and injects dark-theme CSS overrides so it embeds cleanly.
 */
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
      headers: {
        ...HEADERS,
        Referer: LNORI_ORIGIN + "/",
      },
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

    // If a page anchor is requested, inject a script to scroll to it on load
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

/**
 * GET /api/lnori/toc?bookId=<id>&slug=<slug>
 *
 * Returns the table of contents for a lnori.com book as JSON.
 * Parses the TOC nav from the SSR HTML.
 */
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

    // Extract book title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const bookTitle = titleMatch ? titleMatch[1].trim() : "";

    // Extract TOC entries from <nav class="toc-view"> ... </nav>
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

/**
 * GET /api/lnori/find?anilistId=<id>&title=<title>
 *
 * Attempts to find a novel on lnori.com.
 * Checks AniList externalLinks for a lnori.com URL first, then tries slug derivation.
 * Returns { found: true, bookId, slug, url } or { found: false, searchUrl }.
 */
router.get("/lnori/find", async (req, res) => {
  const anilistId = typeof req.query.anilistId === "string" ? req.query.anilistId.trim() : "";
  const title = typeof req.query.title === "string" ? req.query.title.trim() : "";

  if (!anilistId && !title) {
    res.status(400).json({ error: "anilistId or title required" });
    return;
  }

  // 1. Check AniList externalLinks for a lnori.com URL
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
        const lnoriMatch = link.url.match(/lnori\.com\/book\/(\d+)\/([^/?#]+)/);
        if (lnoriMatch) {
          res.json({
            found: true,
            bookId: lnoriMatch[1],
            slug: lnoriMatch[2],
            url: link.url,
          });
          return;
        }
      }
    } catch {
      // fall through to slug probing
    }
  }

  // 2. Try to derive slug from title and probe candidate URLs
  // lnori slug pattern: lowercase, special chars replaced with hyphens
  if (title) {
    const makeSlug = (s: string) =>
      s
        .toLowerCase()
        .replace(/['']/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    // Try AniList to get more title variants
    let candidates: string[] = [];
    const baseSlug = makeSlug(title);
    candidates.push(baseSlug);
    candidates.push(makeSlug(title.split(/[:\-–]/)[0].trim()));
    candidates.push(makeSlug(title.replace(/^(the|a|an)\s+/i, "")));
    candidates = [...new Set(candidates.filter(Boolean))];

    // We can't probe without the numeric book ID, so just return not_found
    // with a helpful search link to lnori.com
    const searchUrl = `https://lnori.com/search?q=${encodeURIComponent(title)}`;
    res.json({ found: false, searchUrl, hint: "lnori.com search requires browser JS" });
    return;
  }

  res.json({ found: false, searchUrl: `https://lnori.com` });
});

export default router;

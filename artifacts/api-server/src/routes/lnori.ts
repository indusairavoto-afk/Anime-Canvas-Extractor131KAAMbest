import { Router } from "express";
import { db } from "@workspace/db";
import { lnoriMappingTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const LNORI_ORIGIN = "https://lnori.com";
const PASS_PREFIX = "/api/lnori/pass";
const RANOBEDB_API = "https://ranobedb.org/api/v0/series";

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

/* ── Helpers ────────────────────────────────────────────────────────────── */

function rewriteHtmlUrls(html: string): string {
  return html
    .replace(new RegExp(`${LNORI_ORIGIN}/`, "g"), `${PASS_PREFIX}/`)
    .replace(/(src|href|action)="\/(?!\/|api\/lnori\/)/g, `$1="${PASS_PREFIX}/`)
    .replace(/(src|href|action)='\/(?!\/|api\/lnori\/)/g, `$1='${PASS_PREFIX}/`)
    .replace(/url\(\/(?!\/|api\/lnori\/)/g, `url(${PASS_PREFIX}/`);
}

function injectIntoHtml(html: string, injection: string): string {
  if (html.includes("</head>")) return html.replace("</head>", injection + "</head>");
  if (html.includes("<head>")) return html.replace("<head>", "<head>" + injection);
  return injection + html;
}

function labelFromSlug(slug: string): string {
  const volMatch = slug.match(/-vol-(\d+(?:\.\d+)?)$/i);
  if (volMatch) return `Vol. ${volMatch[1]}`;
  return slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function parseBookLinks(html: string): { bookId: string; slug: string; label: string }[] {
  const seen = new Set<string>();
  const results: { bookId: string; slug: string; label: string }[] = [];
  const re = /href="\/book\/(\d+)\/([^"?#]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const bookId = m[1];
    if (seen.has(bookId)) continue;
    seen.add(bookId);
    results.push({ bookId, slug: m[2], label: labelFromSlug(m[2]) });
  }
  return results;
}

/** Normalize a title for fuzzy comparison. */
function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Score how well a ranobedb series result matches a query title (0–100). */
function scoreMatch(candidate: { title?: string; title_orig?: string; romaji_orig?: string }, query: string): number {
  const q = normalizeTitle(query);
  const fields = [candidate.title, candidate.title_orig, candidate.romaji_orig]
    .filter(Boolean)
    .map(s => normalizeTitle(s!));

  for (const f of fields) {
    if (f === q) return 100;
  }
  for (const f of fields) {
    if (f.startsWith(q) || q.startsWith(f)) return 90;
  }
  for (const f of fields) {
    if (f.includes(q) || q.includes(f)) return 80;
  }

  // Word-overlap score
  const qWords = new Set(q.split(" ").filter(w => w.length > 2));
  let best = 0;
  for (const f of fields) {
    const fWords = new Set(f.split(" ").filter(w => w.length > 2));
    const overlap = [...qWords].filter(w => fWords.has(w)).length;
    const score = Math.round((overlap / Math.max(qWords.size, fWords.size, 1)) * 65);
    if (score > best) best = score;
  }
  return best;
}

interface RanobedbSeries {
  id: number;
  title?: string;
  title_orig?: string;
  romaji_orig?: string;
}

/**
 * Query ranobedb.org to find the series ID for a given title.
 * Returns { seriesId } or null.
 */
async function findViaRanobedb(title: string): Promise<{ seriesId: string } | null> {
  const queries = [
    title,
    title.split(/[:–\-]/)[0].trim(),
    title.replace(/\s*\(.*?\)\s*/g, " ").trim(),
  ].filter((q, i, a) => q.length > 2 && a.indexOf(q) === i);

  const MIN_SCORE = 72;

  for (const q of queries) {
    try {
      const res = await fetch(
        `${RANOBEDB_API}?title=${encodeURIComponent(q)}&limit=20`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const series: RanobedbSeries[] = data.series ?? [];

      let bestScore = 0;
      let bestId: number | null = null;
      for (const s of series) {
        const score = scoreMatch(s, title);
        if (score > bestScore) { bestScore = score; bestId = s.id; }
        if (score === 100) break;
      }

      if (bestScore >= MIN_SCORE && bestId !== null) {
        return { seriesId: String(bestId) };
      }
    } catch {
      // try next query variant
    }
  }
  return null;
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
        try { res.setHeader(key, value); } catch { /* skip */ }
      }
    }

    res.status(upstream.status);
    res.send(Buffer.from(await upstream.arrayBuffer()));
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

    let html = rewriteHtmlUrls(await upstream.text());
    html = injectIntoHtml(html, READER_STYLE);

    if (page) {
      html = injectIntoHtml(
        html,
        `<script>(function(){function go(){var el=document.getElementById(${JSON.stringify(page)});if(el)el.scrollIntoView({behavior:'smooth'});}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',go);}else{setTimeout(go,200);}}());</script>`
      );
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
      const linkRe = /<a[^>]+href="(#[^"]+)"[^>]*>([^<]+)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(tocMatch[1])) !== null) {
        tocEntries.push({ anchor: m[1].replace(/^#/, ""), label: m[2].trim() });
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
 * slug is optional — lnori.com serves /series/{id} without a slug too.
 */
router.get("/lnori/series", async (req, res) => {
  const seriesId = typeof req.query.seriesId === "string" ? req.query.seriesId.trim() : "";
  const slug = typeof req.query.slug === "string" ? req.query.slug.trim() : "";

  if (!seriesId) {
    res.status(400).json({ error: "seriesId is required" });
    return;
  }

  const seriesPath = slug ? `/series/${seriesId}/${slug}` : `/series/${seriesId}`;

  try {
    const upstream = await fetch(`${LNORI_ORIGIN}${seriesPath}`, {
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

/* ── Save mapping ───────────────────────────────────────────────────────── */

/**
 * POST /api/lnori/save
 * Body: { anilistId: number, lnoriUrl: string }
 * Upserts a manual lnori URL mapping into the DB.
 */
router.post("/lnori/save", async (req, res) => {
  const { anilistId, lnoriUrl } = req.body as { anilistId?: number; lnoriUrl?: string };

  if (!anilistId || !lnoriUrl) {
    res.status(400).json({ error: "anilistId and lnoriUrl are required" });
    return;
  }

  const isValid = /lnori\.com\/(series|book)\//.test(lnoriUrl);
  if (!isValid) {
    res.status(400).json({ error: "lnoriUrl must be a lnori.com series or book URL" });
    return;
  }

  const lnoriType = lnoriUrl.includes("/series/") ? "series" : "book";

  try {
    await db
      .insert(lnoriMappingTable)
      .values({ anilistId, lnoriUrl, lnoriType })
      .onConflictDoUpdate({
        target: lnoriMappingTable.anilistId,
        set: { lnoriUrl, lnoriType, savedAt: new Date() },
      });
    res.json({ ok: true });
  } catch (err: unknown) {
    req.log?.error(err);
    res.status(500).json({ error: "Failed to save mapping" });
  }
});

/* ── Find novel ─────────────────────────────────────────────────────────── */

/**
 * GET /api/lnori/find?anilistId=<id>&title=<title>
 *
 * Resolution order:
 *  1. DB saved mappings  (from previous sessions)
 *  2. AniList externalLinks  (lnori.com series or book links)
 *  3. ranobedb.org search API  (series ID = lnori series ID)
 */
router.get("/lnori/find", async (req, res) => {
  const anilistId = typeof req.query.anilistId === "string" ? req.query.anilistId.trim() : "";
  const title = typeof req.query.title === "string" ? req.query.title.trim() : "";

  if (!anilistId && !title) {
    res.status(400).json({ error: "anilistId or title required" });
    return;
  }

  // 1. Check DB for saved mapping
  if (anilistId) {
    try {
      const rows = await db
        .select()
        .from(lnoriMappingTable)
        .where(eq(lnoriMappingTable.anilistId, Number(anilistId)))
        .limit(1);

      if (rows.length > 0) {
        const saved = rows[0];
        const seriesMatch = saved.lnoriUrl.match(/lnori\.com\/series\/(\d+)\/([^/?#]*)/);
        const bookMatch = saved.lnoriUrl.match(/lnori\.com\/book\/(\d+)\/([^/?#]+)/);
        if (seriesMatch) {
          res.json({ found: true, type: "series", seriesId: seriesMatch[1], slug: seriesMatch[2] });
          return;
        }
        if (bookMatch) {
          res.json({ found: true, type: "book", bookId: bookMatch[1], slug: bookMatch[2] });
          return;
        }
      }
    } catch {
      // fall through
    }
  }

  // 2. Check AniList externalLinks
  if (anilistId) {
    try {
      const aniRes = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `query($id:Int!){Media(id:$id,type:MANGA){externalLinks{url site}}}`,
          variables: { id: Number(anilistId) },
        }),
        signal: AbortSignal.timeout(10000),
      });
      const aniData = await aniRes.json();
      const links: { url: string }[] = aniData?.data?.Media?.externalLinks ?? [];

      for (const link of links) {
        const sm = link.url.match(/lnori\.com\/series\/(\d+)\/([^/?#]*)/);
        if (sm) { res.json({ found: true, type: "series", seriesId: sm[1], slug: sm[2] }); return; }
        const bm = link.url.match(/lnori\.com\/book\/(\d+)\/([^/?#]+)/);
        if (bm) { res.json({ found: true, type: "book", bookId: bm[1], slug: bm[2] }); return; }
      }
    } catch {
      // fall through
    }
  }

  // 3. Try ranobedb search (series ID matches lnori series ID)
  if (title) {
    try {
      const result = await findViaRanobedb(title);
      if (result) {
        const lnoriUrl = `https://lnori.com/series/${result.seriesId}`;
        // Auto-save to DB so next time it's instant
        if (anilistId) {
          db.insert(lnoriMappingTable)
            .values({ anilistId: Number(anilistId), lnoriUrl, lnoriType: "series" })
            .onConflictDoUpdate({
              target: lnoriMappingTable.anilistId,
              set: { lnoriUrl, lnoriType: "series", savedAt: new Date() },
            })
            .catch(() => {});
        }
        res.json({ found: true, type: "series", seriesId: result.seriesId, slug: "" });
        return;
      }
    } catch {
      // fall through
    }
  }

  res.json({ found: false, searchUrl: "https://lnori.com/library#search" });
});

export default router;

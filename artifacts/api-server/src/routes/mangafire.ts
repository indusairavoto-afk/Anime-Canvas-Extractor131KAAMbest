import { Router } from "express";

const router = Router();

const ORIGIN = "https://mangafire.to";
const PASS = "/api/mangafire/pass";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://mangafire.to/",
};

function makeSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * GET /api/mangafire/find?title=<title>
 *
 * Searches mangafire.to for the manga and returns its slug.
 */
router.get("/mangafire/find", async (req, res) => {
  const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  const queries = [
    title,
    title.replace(/^(the|a|an)\s+/i, ""),
    title.split(/[:\-–]/)[0].trim(),
  ].filter(Boolean);

  for (const q of [...new Set(queries)]) {
    try {
      const searchUrl = `${ORIGIN}/filter?keyword=${encodeURIComponent(q)}&type[]=manga&type[]=one_shot&type[]=manhwa&type[]=manhua&type[]=doujinshi`;
      const resp = await fetch(searchUrl, {
        headers: { ...HEADERS, Accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) continue;
      const html = await resp.text();

      // Extract manga slugs from the listing page
      // mangafire URLs look like: href="/manga/one-piece.dkw"
      const slugRe = /href="\/manga\/([\w.-]+)"/g;
      let m: RegExpExecArray | null;
      const candidates: string[] = [];
      while ((m = slugRe.exec(html)) !== null) {
        candidates.push(m[1]);
      }

      if (candidates.length === 0) continue;

      // Pick the candidate whose title-part best matches the query slug
      const qSlug = makeSlug(q);
      const scored = candidates.map((slug) => {
        const titlePart = slug.includes(".") ? slug.split(".")[0] : slug;
        // Exact match or starts-with
        const score =
          titlePart === qSlug ? 2 : titlePart.startsWith(qSlug) ? 1 : 0;
        return { slug, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (best && best.score > 0) {
        res.json({ found: true, slug: best.slug, url: `/manga/${best.slug}` });
        return;
      }
      // If nothing scored, take first result anyway (search is contextual)
      if (candidates[0]) {
        res.json({ found: true, slug: candidates[0], url: `/manga/${candidates[0]}` });
        return;
      }
    } catch {
      // try next query
    }
  }

  res.json({ found: false });
});

/**
 * Builds the CSS + JS injection for mangafire proxied pages.
 */
function buildInjection(): string {
  return `<style id="na-mangafire-hide">
header, nav, footer,
[class*="header"],[class*="navbar"],[class*="topbar"],
[class*="sidebar"],[class*="footer"],[class*="side-bar"],
[class*="cookie"],[class*="notification"],[class*="popup"],
[class*="ad-"],[class*="-ad"],[id*="ad-"],[id*="-ad"],
.overlay-notice, #overlay-notice, .notice, #notice,
.fixed-bottom, .back-to-top, .social-share,
[id="header"], [id="footer"], [id="sidebar"],
.site-menu, .site-header, .site-footer,
.toolbar-area, #toolbar-area {
  display: none !important;
}
html, body {
  padding-top: 0 !important;
  margin-top: 0 !important;
  background: #0a0a0a !important;
  overflow-x: hidden !important;
}
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: #111; }
::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #555; }
/* reader page: hide non-essential chrome */
#chapter-head, .chapter-head, .chapter-toolbar .non-reader { display: none !important; }
</style>
<script>
(function() {
  var PASS = ${JSON.stringify(PASS)};
  var ORIGIN = ${JSON.stringify(ORIGIN)};

  function rewriteUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    if (url.startsWith(ORIGIN + '/')) return PASS + '/' + url.slice(ORIGIN.length + 1);
    if (url === ORIGIN) return PASS + '/';
    if (url.startsWith('/api/mangafire/')) return url;
    if (url.startsWith('/')) return PASS + url;
    return url;
  }

  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') input = rewriteUrl(input);
    else if (input instanceof Request) {
      var newUrl = rewriteUrl(input.url);
      if (newUrl !== input.url) input = new Request(newUrl, init || input);
    }
    return _fetch.call(this, input, init);
  };

  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function() {
    var args = Array.prototype.slice.call(arguments);
    if (typeof args[1] === 'string') args[1] = rewriteUrl(args[1]);
    return _open.apply(this, args);
  };

  document.addEventListener('click', function(e) {
    var el = e.target && e.target.closest && e.target.closest('a');
    if (!el) return;
    var href = el.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) return;
    if (href.startsWith('http') && !href.startsWith(ORIGIN) && !href.startsWith(PASS)) return;
    e.preventDefault();
    var path = href.startsWith(ORIGIN) ? href.slice(ORIGIN.length) : href;
    if (path.startsWith(PASS)) path = path.slice(PASS.length);
    window.location.href = '/api/mangafire/reader?path=' + encodeURIComponent(path);
  }, true);

  var _pushState = history.pushState.bind(history);
  history.pushState = function(state, title, url) {
    if (url && typeof url === 'string' && !url.startsWith('/api/mangafire/')) {
      var rewritten = rewriteUrl(url);
      if (rewritten !== url) {
        // convert to a reader path so a hard reload still works
        var path = url.startsWith(ORIGIN) ? url.slice(ORIGIN.length) : url;
        url = '/api/mangafire/reader?path=' + encodeURIComponent(path);
      }
    }
    return _pushState(state, title, url);
  };
})();
</script>`;
}

function rewriteHtmlUrls(html: string): string {
  return html
    .replace(/https:\/\/mangafire\.to\//g, `${PASS}/`)
    .replace(/(src|href|action)="\/(?!\/|api\/mangafire\/)/g, `$1="${PASS}/`)
    .replace(/(src|href|action)='\/(?!\/|api\/mangafire\/)/g, `$1='${PASS}/`)
    .replace(/url\(\/(?!\/|api\/mangafire\/)/g, `url(${PASS}/`)
    .replace(/url\("\/(?!\/|api\/mangafire\/)/g, `url("${PASS}/`)
    .replace(/url\('\/(?!\/|api\/mangafire\/)/g, `url('${PASS}/`);
}

function injectIntoHtml(html: string, injection: string): string {
  if (html.includes("<head>")) return html.replace("<head>", "<head>" + injection);
  if (html.includes("<head ")) return html.replace(/<head [^>]*>/, (m) => m + injection);
  return injection + html;
}

/**
 * GET /api/mangafire/reader?path=<mangafire path>
 */
router.get("/mangafire/reader", async (req, res) => {
  const path = typeof req.query.path === "string" ? req.query.path : "/";
  const upstreamUrl = `${ORIGIN}${path.startsWith("/") ? path : "/" + path}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        ...HEADERS,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    if (!upstream.ok) {
      res.status(upstream.status).send(
        `<html><body style="background:#0a0a0a;color:#fff;font-family:monospace;padding:2rem">mangafire.to returned ${upstream.status} for ${path}</body></html>`
      );
      return;
    }

    let html = rewriteHtmlUrls(await upstream.text());
    html = injectIntoHtml(html, buildInjection());

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Cache-Control", "no-store");
    res.send(html);
  } catch (err: unknown) {
    req.log.error(err);
    res.status(502).send(
      `<html><body style="background:#0a0a0a;color:#fff;font-family:monospace;padding:2rem">Failed to load reader from mangafire.to</body></html>`
    );
  }
});

/**
 * ALL /api/mangafire/pass/*  — pass-through proxy
 */
router.all("/mangafire/pass/*path", async (req, res) => {
  const rawPath = (req.params as Record<string, string | string[]>).path;
  const rest = (Array.isArray(rawPath) ? rawPath.join("/") : rawPath ?? "").replace(/^\//, "");
  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const upstreamUrl = `${ORIGIN}/${rest}${search}`;

  try {
    const isPost = ["POST", "PUT", "PATCH"].includes(req.method);
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        ...HEADERS,
        Origin: ORIGIN,
        ...(req.headers["content-type"]
          ? { "Content-Type": req.headers["content-type"] as string }
          : {}),
        ...(req.headers["cookie"] ? { Cookie: req.headers["cookie"] as string } : {}),
        ...(req.headers["x-requested-with"]
          ? { "X-Requested-With": req.headers["x-requested-with"] as string }
          : {}),
      },
      body: isPost ? (req as unknown as BodyInit) : undefined,
      signal: AbortSignal.timeout(20000),
    });

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With, Accept");

    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) res.setHeader("Set-Cookie", setCookie);

    const isApi = rest.startsWith("ajax") || rest.startsWith("api/");
    res.setHeader("Cache-Control", isApi ? "no-store" : "public, max-age=86400");
    res.status(upstream.status);

    const buf = await upstream.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err: unknown) {
    req.log.error(err);
    res.status(502).json({ error: "MangaFire proxy error" });
  }
});

export default router;

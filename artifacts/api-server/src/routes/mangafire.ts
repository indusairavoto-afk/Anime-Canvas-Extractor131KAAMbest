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
 * MangaFire slug pattern: take the normal slug and double the last character
 * of the final word.  e.g. "chainsaw man" → "chainsaw-mann", "one piece" → "one-piecee".
 * The full slug is "{doubled-title}.{3-6-char-id}".
 */
function makeDoubledSlug(s: string): string {
  const base = makeSlug(s);          // e.g. "chainsaw-man"
  if (!base) return base;
  const last = base[base.length - 1]; // e.g. "n"
  return base + last;                  // e.g. "chainsaw-mann"
}

/**
 * Search one sitemap XML for a slug whose title part starts with `doubledSlug`.
 * Returns the first matching full slug (e.g. "chainsaw-mann.0w5k") or null.
 */
async function searchSitemap(idx: number, doubledSlug: string): Promise<string | null> {
  try {
    const resp = await fetch(`${ORIGIN}/sitemap-list-${idx}.xml`, {
      headers: { ...HEADERS, Accept: "application/xml, text/xml, */*" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    // URLs look like: https://mangafire.to/manga/chainsaw-mann.0w5k
    const re = /mangafire\.to\/manga\/([\w.-]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const slug = m[1];
      // title part is everything before the last dot segment (the ID)
      const dotIdx = slug.lastIndexOf(".");
      const titlePart = dotIdx > 0 ? slug.slice(0, dotIdx) : slug;
      if (titlePart === doubledSlug || titlePart.startsWith(doubledSlug)) {
        return slug;
      }
    }
  } catch { /* timeout / network error */ }
  return null;
}

/**
 * Search all sitemaps in parallel (total 54 files), race to first hit.
 */
async function searchAllSitemaps(doubledSlug: string): Promise<string | null> {
  const TOTAL = 54;
  // Search in batches of 10 to avoid too many simultaneous connections
  const BATCH = 10;
  for (let start = 1; start <= TOTAL; start += BATCH) {
    const indices = Array.from(
      { length: Math.min(BATCH, TOTAL - start + 1) },
      (_, i) => start + i
    );
    const results = await Promise.all(indices.map(i => searchSitemap(i, doubledSlug)));
    const found = results.find(r => r !== null);
    if (found) return found;
  }
  return null;
}

/**
 * GET /api/mangafire/find?title=<title>
 *
 * MangaFire's search is client-side JS only — the AJAX endpoint requires a
 * Cloudflare-gated session token.  Instead we derive the slug using the
 * documented pattern (double last char of last word) and confirm it against
 * the sitemap XMLs.
 */
router.get("/mangafire/find", async (req, res) => {
  const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  // Build candidate doubled slugs from various title normalizations
  const queries = [
    title,
    title.replace(/^(the|a|an)\s+/i, ""),
    title.split(/[:\-–]/)[0].trim(),
  ].filter(Boolean);

  const doubled = [...new Set(queries.map(makeDoubledSlug))];

  // Search all sitemaps in parallel for each candidate
  for (const d of doubled) {
    const slug = await searchAllSitemaps(d);
    if (slug) {
      res.json({
        found: true,
        slug,
        url: `/manga/${slug}`,
        readUrl: `/read/${slug}/en/chapter-1`,
      });
      return;
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
#chapter-head, .chapter-head { display: none !important; }
</style>
<script>
(function() {
  var PASS = ${JSON.stringify(PASS)};
  var ORIGIN = ${JSON.stringify(ORIGIN)};

  /* Rewrite asset/API URLs through the pass proxy */
  function rewriteUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    if (url.startsWith(ORIGIN + '/')) return PASS + '/' + url.slice(ORIGIN.length + 1);
    if (url === ORIGIN) return PASS + '/';
    if (url.startsWith('/api/mangafire/')) return url;
    if (url.startsWith('/')) return PASS + url;
    return url;
  }

  /* Convert any URL to a reader page (for navigation) */
  function toReaderPath(url) {
    if (!url || typeof url !== 'string') return null;
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) return null;
    if (url.startsWith('/api/mangafire/reader')) return url; // already a reader URL
    var path;
    if (url.startsWith(ORIGIN)) {
      path = url.slice(ORIGIN.length) || '/';
    } else if (url.startsWith('/api/mangafire/pass')) {
      path = url.slice('/api/mangafire/pass'.length) || '/';
    } else if (url.startsWith('/')) {
      path = url;
    } else {
      // relative, e.g. "home", "newest"
      path = '/' + url;
    }
    return '/api/mangafire/reader?path=' + encodeURIComponent(path);
  }

  /* Patch fetch */
  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') input = rewriteUrl(input);
    else if (input instanceof Request) {
      var newUrl = rewriteUrl(input.url);
      if (newUrl !== input.url) input = new Request(newUrl, init || input);
    }
    return _fetch.call(this, input, init);
  };

  /* Patch XHR */
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function() {
    var args = Array.prototype.slice.call(arguments);
    if (typeof args[1] === 'string') args[1] = rewriteUrl(args[1]);
    return _open.apply(this, args);
  };

  /* Intercept location.href, location.assign, location.replace
     so MangaFire JS cannot redirect the iframe to our app root */
  try {
    var locProto = Location.prototype;
    var _hrefDesc = Object.getOwnPropertyDescriptor(locProto, 'href');
    if (_hrefDesc && _hrefDesc.set) {
      Object.defineProperty(locProto, 'href', {
        get: _hrefDesc.get,
        set: function(url) {
          var r = toReaderPath(url);
          if (r) { _hrefDesc.set.call(window.location, r); }
          else    { _hrefDesc.set.call(window.location, url); }
        },
        configurable: true,
      });
    }
    var _assign = locProto.assign;
    locProto.assign = function(url) { var r = toReaderPath(url); _assign.call(window.location, r || url); };
    var _replace = locProto.replace;
    locProto.replace = function(url) { var r = toReaderPath(url); _replace.call(window.location, r || url); };
  } catch(e) { /* best-effort */ }

  /* Intercept link clicks */
  document.addEventListener('click', function(e) {
    var el = e.target && e.target.closest && e.target.closest('a');
    if (!el) return;
    var href = el.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) return;
    /* allow clicks to external sites (ads etc.) to open normally */
    if (href.startsWith('http') && !href.startsWith(ORIGIN)) return;
    e.preventDefault();
    var r = toReaderPath(href);
    if (r) window.location.href = r;
  }, true);

  /* Intercept history.pushState / replaceState */
  function wrapHistoryMethod(name) {
    var orig = history[name].bind(history);
    history[name] = function(state, title, url) {
      if (url && typeof url === 'string' && !url.startsWith('/api/mangafire/reader')) {
        var r = toReaderPath(url);
        if (r) url = r;
      }
      return orig(state, title, url);
    };
  }
  wrapHistoryMethod('pushState');
  wrapHistoryMethod('replaceState');
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
      body: isPost ? (req as any) : undefined,
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

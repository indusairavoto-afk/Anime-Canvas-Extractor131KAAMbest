import { Router } from "express";

const router = Router();

const ONISAGA_ORIGIN = "https://onisaga.com";
const PASS_PREFIX = "/api/onisaga/pass";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * GET /api/onisaga/pass/*
 *
 * Pass-through proxy for all onisaga.com assets, Livewire endpoints, and API calls.
 * Strips X-Frame-Options / CSP so the embedded iframe can load them.
 */
router.all("/onisaga/pass/*path", async (req, res) => {
  const rawPath = (req.params as Record<string, string | string[]>).path;
  const rest = (Array.isArray(rawPath) ? rawPath.join("/") : rawPath ?? "").replace(/^\//, "");
  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const upstreamUrl = `${ONISAGA_ORIGIN}/${rest}${search}`;

  try {
    const isPost = req.method === "POST" || req.method === "PUT" || req.method === "PATCH";
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        ...HEADERS,
        Origin: ONISAGA_ORIGIN,
        Referer: ONISAGA_ORIGIN + "/",
        ...(req.headers["content-type"]
          ? { "Content-Type": req.headers["content-type"] as string }
          : {}),
        ...(req.headers["x-csrf-token"]
          ? { "X-CSRF-TOKEN": req.headers["x-csrf-token"] as string }
          : {}),
        ...(req.headers["x-livewire"]
          ? { "X-Livewire": req.headers["x-livewire"] as string }
          : {}),
        ...(req.headers["cookie"] ? { Cookie: req.headers["cookie"] as string } : {}),
      },
      body: isPost ? (req as unknown as BodyInit) : undefined,
    });

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-TOKEN, X-Livewire, Accept");

    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) res.setHeader("Set-Cookie", setCookie);

    if (rest.startsWith("livewire") || rest.startsWith("api/")) {
      res.setHeader("Cache-Control", "no-store, no-cache");
    } else {
      const cc = upstream.headers.get("cache-control");
      res.setHeader("Cache-Control", cc || "public, max-age=86400");
    }

    res.status(upstream.status);
    const buf = await upstream.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err: unknown) {
    req.log.error(err);
    res.status(502).json({ error: "OniSaga proxy error" });
  }
});

/**
 * GET /api/onisaga/find?title=<manga title>
 *
 * Derives a URL slug from the title and probes onisaga.com/manga/{slug}.
 * onisaga is fully SSR so a 200 confirms the manga exists.
 */
function makeSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

router.get("/onisaga/find", async (req, res) => {
  const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  const slug = makeSlug(title);
  const candidates = [
    slug,
    // Without common leading articles
    makeSlug(title.replace(/^(the|a|an)\s+/i, "")),
    // Without colons and subtitles
    makeSlug(title.split(/[:\-–]/)[0].trim()),
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates)]) {
    try {
      const upstreamUrl = `${ONISAGA_ORIGIN}/manga/${candidate}`;
      const response = await fetch(upstreamUrl, {
        headers: {
          ...HEADERS,
          Accept: "text/html,application/xhtml+xml",
          Referer: ONISAGA_ORIGIN + "/",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) {
        const html = await response.text();
        // Check it's actually a manga page (has chapter links)
        if (html.includes(`/read/${candidate}/`)) {
          res.json({ found: true, url: `/manga/${candidate}` });
          return;
        }
      }
    } catch {
      // try next candidate
    }
  }

  res.json({ found: false });
});

/**
 * Builds the CSS + JS injection for onisaga proxied pages.
 * Hides navigation/footer, rewrites all fetch/XHR through the pass proxy,
 * and intercepts link clicks to keep navigation inside the reader.
 */
function buildInjection(PASS: string, ORIGIN: string): string {
  return `<style id="na-onisaga-hide">
header, nav, footer,
[role="banner"],[role="navigation"],[role="contentinfo"],
[class*="header"],[class*="navbar"],[class*="topbar"],
[class*="sidebar"],[class*="footer"],
[class*="cookie"],[class*="banner"][class*="ad"],
[class*="advertisement"],[class*="popup"],[class*="notification"],
[id*="cookie"],[id*="banner"][id*="ad"],
.nav-header, .site-header, .site-footer,
#header, #nav, #navbar, #footer, #sidebar {
  display: none !important;
}
html, body {
  padding-top: 0 !important;
  margin-top: 0 !important;
  background: #0a0a0a !important;
}
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: #111; }
::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #555; }
</style>
<script>
(function() {
  var PASS = ${JSON.stringify(PASS)};
  var ORIGIN = ${JSON.stringify(ORIGIN)};

  function rewriteUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith(ORIGIN + '/')) return PASS + '/' + url.slice(ORIGIN.length + 1);
    if (url === ORIGIN) return PASS + '/';
    if (url.startsWith('/api/onisaga/')) return url;
    if (url.startsWith('/')) return PASS + url;
    return url;
  }

  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') input = rewriteUrl(input);
    else if (input instanceof Request) {
      var newUrl = rewriteUrl(input.url);
      if (newUrl !== input.url) input = new Request(newUrl, input);
    }
    return _fetch.call(this, input, init);
  };

  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    var args = Array.prototype.slice.call(arguments);
    if (typeof args[1] === 'string') args[1] = rewriteUrl(args[1]);
    return _open.apply(this, args);
  };

  document.addEventListener('click', function(e) {
    var el = e.target && e.target.closest && e.target.closest('a');
    if (!el) return;
    var href = el.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;
    if (href.startsWith('http') && !href.startsWith(ORIGIN) && !href.startsWith(PASS)) return;
    e.preventDefault();
    var path = href.startsWith(ORIGIN) ? href.slice(ORIGIN.length) : href;
    if (path.startsWith(PASS)) path = '/' + path.slice(PASS.length);
    window.location.href = '/api/onisaga/reader?path=' + encodeURIComponent(path);
  }, true);

  /* Livewire v3 uses history.pushState for navigation — intercept it */
  var _pushState = history.pushState.bind(history);
  history.pushState = function(state, title, url) {
    if (url && typeof url === 'string') {
      url = rewriteUrl(url);
    }
    return _pushState(state, title, url);
  };
})();
</script>`;
}

function rewriteHtmlUrls(html: string): string {
  return html
    .replace(/https:\/\/onisaga\.com\//g, `${PASS_PREFIX}/`)
    .replace(/(src|href|action)="\/(?!\/|api\/onisaga\/)/g, `$1="${PASS_PREFIX}/`)
    .replace(/(src|href|action)='\/(?!\/|api\/onisaga\/)/g, `$1='${PASS_PREFIX}/`)
    .replace(/url\(\/(?!\/|api\/onisaga\/)/g, `url(${PASS_PREFIX}/`)
    .replace(/(['"])\/livewire\//g, `$1${PASS_PREFIX}/livewire/`);
}

function injectIntoHtml(html: string, injection: string): string {
  return html.includes("<head>")
    ? html.replace("<head>", "<head>" + injection)
    : injection + html;
}

/**
 * GET /api/onisaga/reader?path=<onisaga path>
 *
 * Fetches an onisaga HTML page, rewrites asset/API URLs, and injects the
 * pass-proxy script so Livewire and Alpine.js work inside the iframe.
 */
router.get("/onisaga/reader", async (req, res) => {
  const path = typeof req.query.path === "string" ? req.query.path : "/";
  const upstreamUrl = `${ONISAGA_ORIGIN}${path.startsWith("/") ? path : "/" + path}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        ...HEADERS,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: ONISAGA_ORIGIN + "/",
      },
      redirect: "follow",
    });

    if (!upstream.ok) {
      res.status(upstream.status).send(
        `<html><body style="background:#0a0a0a;color:#fff;font-family:monospace;padding:2rem">onisaga.com returned ${upstream.status} for ${path}</body></html>`
      );
      return;
    }

    let html = rewriteHtmlUrls(await upstream.text());
    html = injectIntoHtml(html, buildInjection(PASS_PREFIX, ONISAGA_ORIGIN));

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err: unknown) {
    req.log.error(err);
    res.status(502).send(
      `<html><body style="background:#0a0a0a;color:#fff;font-family:monospace;padding:2rem">Failed to load manga reader from onisaga.com</body></html>`
    );
  }
});

export default router;

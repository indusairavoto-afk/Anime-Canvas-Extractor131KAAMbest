import { Router } from "express";

const router = Router();

const COMIX_ORIGIN = "https://comix.to";
const PASS_PREFIX = "/api/comix/pass";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * GET /api/comix/pass/*
 *
 * Pass-through proxy for all comix.to assets (JS, CSS, images, JSON API calls).
 * Strips X-Frame-Options and CORS headers so the embedded iframe can load them.
 */
router.all("/comix/pass/*path", async (req, res) => {
  const rawPath = (req.params as Record<string, string | string[]>).path;
  const rest = (Array.isArray(rawPath) ? rawPath.join("/") : rawPath ?? "").replace(/^\//, "");
  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const upstreamUrl = `${COMIX_ORIGIN}/${rest}${search}`;

  try {
    const isPost = req.method === "POST" || req.method === "PUT" || req.method === "PATCH";
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        ...HEADERS,
        Origin: COMIX_ORIGIN,
        Referer: COMIX_ORIGIN + "/",
        ...(req.headers["content-type"]
          ? { "Content-Type": req.headers["content-type"] as string }
          : {}),
        ...(req.headers["authorization"]
          ? { Authorization: req.headers["authorization"] as string }
          : {}),
        ...(req.headers["cookie"] ? { Cookie: req.headers["cookie"] as string } : {}),
      },
      body: isPost ? (req as unknown as BodyInit) : undefined,
    });

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");

    if (rest.startsWith("api/")) {
      res.setHeader("Cache-Control", "no-store, no-cache");
      res.setHeader("Pragma", "no-cache");
    } else {
      const cc = upstream.headers.get("cache-control");
      res.setHeader("Cache-Control", cc || "public, max-age=86400");
    }

    res.status(upstream.status);
    const buf = await upstream.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err: unknown) {
    req.log.error(err);
    res.status(502).json({ error: "Comix proxy error" });
  }
});

/**
 * GET /api/comix/proxy?path=<comix.to path>
 *
 * Fetches a comix.to HTML page, rewrites all asset/API URLs to go through
 * /api/comix/pass/*, injects CSS to hide comix.to's top navigation (we embed
 * the reader inside our own app shell), and patches fetch/XHR so dynamic API
 * calls also resolve through the proxy.
 */
router.get("/comix/proxy", async (req, res) => {
  const path =
    typeof req.query.path === "string" ? req.query.path : "/browse";
  const upstreamUrl = `${COMIX_ORIGIN}${path.startsWith("/") ? path : "/" + path}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        ...HEADERS,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: COMIX_ORIGIN + "/",
      },
    });

    if (!upstream.ok) {
      res
        .status(upstream.status)
        .send(`<html><body style="background:#111;color:#fff;font-family:monospace;padding:2rem">comix.to returned ${upstream.status} for ${path}</body></html>`);
      return;
    }

    let html = await upstream.text();

    // Rewrite absolute comix.to URLs → /api/comix/pass/...
    html = html.replace(/https:\/\/comix\.to\//g, `${PASS_PREFIX}/`);

    // Rewrite root-relative src/href/url() → /api/comix/pass/...
    html = html
      .replace(/(src|href)="\/(?!\/|api\/comix\/)/g, `$1="${PASS_PREFIX}/`)
      .replace(/(src|href)='\/(?!\/|api\/comix\/)/g, `$1='${PASS_PREFIX}/`)
      .replace(/url\(\/(?!\/|api\/comix\/)/g, `url(${PASS_PREFIX}/`);

    const PASS = PASS_PREFIX;
    const COMIX = COMIX_ORIGIN;

    const injection = `<style id="na-comix-hide">
/* Hide comix.to top nav — embedded inside our app shell */
header,nav,
[role="banner"],[role="navigation"],
[class*="header"],[class*="Header"],
[class*="navbar"],[class*="Navbar"],
[class*="topbar"],[class*="Topbar"],
[class*="top-bar"],[class*="TopBar"] {
  display: none !important;
}
html,body {
  padding-top: 0 !important;
  margin-top: 0 !important;
  background: #0f0f0f !important;
}
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: #111; }
::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #666; }
</style>
<script>
(function() {
  /* Block service worker — avoid asset precache flooding our proxy with 404s */
  try {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: function() { return Promise.resolve({ scope: '/', active: null }); },
        ready: Promise.resolve({ scope: '/', active: null }),
        controller: null,
        getRegistrations: function() { return Promise.resolve([]); },
        getRegistration: function() { return Promise.resolve(undefined); },
        addEventListener: function() {},
        removeEventListener: function() {},
      },
      configurable: true,
    });
  } catch(e) {}

  var PASS = ${JSON.stringify(PASS)};
  var COMIX = ${JSON.stringify(COMIX)};

  function rewriteUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith(COMIX + '/')) return PASS + '/' + url.slice(COMIX.length + 1);
    if (url === COMIX) return PASS + '/';
    if (!url.startsWith('/api/comix/')) {
      if (url.startsWith('/api/') || url.startsWith('/assets/') ||
          url.startsWith('/uploads/') || url.startsWith('/manga/') ||
          url.startsWith('/graphql')) {
        return PASS + url;
      }
    }
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
})();
</script>`;

    if (html.includes("<head>")) {
      html = html.replace("<head>", "<head>" + injection);
    } else {
      html = injection + html;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.send(html);
  } catch (err: unknown) {
    req.log.error(err);
    res.status(502).send(
      `<html><body style="background:#111;color:#fff;font-family:monospace;padding:2rem">Failed to load manga reader from comix.to</body></html>`
    );
  }
});

export default router;

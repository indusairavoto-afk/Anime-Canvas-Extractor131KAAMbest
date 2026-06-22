import { Router } from "express";

const router = Router();

const MIRURO_ORIGIN = "https://www.miruro.bz";
const PASS_PREFIX = "/api/miruro/pass";

function toMiruroSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const ASSET_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

const PAGE_HEADERS = {
  ...ASSET_HEADERS,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  Referer: MIRURO_ORIGIN,
};

/**
 * GET /api/miruro/pass/*
 *
 * Wildcard pass-through proxy: forwards any path to miruro.to and returns
 * the response without X-Frame-Options or CORS restrictions. Because all
 * assets share the /api/miruro/pass/ prefix, ES module relative imports
 * (e.g. ./chunk.js inside a proxied JS bundle) resolve back through this
 * same proxy automatically — no additional rewriting needed.
 */
router.all("/miruro/pass/*path", async (req, res) => {
  // req.params.path is the wildcard portion after /miruro/pass/
  const rawPath = (req.params as Record<string, string | string[]>).path;
  const rest = (Array.isArray(rawPath) ? rawPath.join("/") : rawPath ?? "").replace(/^\//, "");
  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const upstreamUrl = `${MIRURO_ORIGIN}/${rest}${search}`;

  try {
    const isPost = req.method === "POST" || req.method === "PUT" || req.method === "PATCH";
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        ...ASSET_HEADERS,
        ...(req.headers["content-type"]
          ? { "Content-Type": req.headers["content-type"] as string }
          : {}),
        Origin: MIRURO_ORIGIN,
        Referer: MIRURO_ORIGIN + "/",
      },
      body: isPost ? req : undefined,
    });

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const cacheControl = upstream.headers.get("cache-control");

    // Forward safe headers; intentionally omit X-Frame-Options, CSP, and CORS restrictions
    res.setHeader("Content-Type", contentType);
    // API paths carry session-encrypted payloads (pipe, jwks, monkey, events).
    // The browser MUST NOT cache these — a cached pipe response decrypted with a
    // fresh session key produces garbage (→ empty sources → black player).
    // Force no-store for any /api/* path so the browser always makes a fresh
    // request and never sends If-None-Match / If-Modified-Since conditionals.
    if (rest.startsWith("api/")) {
      res.setHeader("Cache-Control", "no-store, no-cache");
      res.setHeader("Pragma", "no-cache");
    } else if (cacheControl) {
      res.setHeader("Cache-Control", cacheControl);
    } else {
      res.setHeader("Cache-Control", "public, max-age=86400");
    }

    // Forward x-obfuscated header — the Miruro SPA reads this to decide how to
    // decrypt the /api/secure/pipe response (XOR + decompress when value is "2").
    // Without it the SPA JSON-parses the raw encrypted bytes → parse error →
    // falls back to YouTube trailer instead of the episode.
    const xObfuscated = upstream.headers.get("x-obfuscated");
    if (xObfuscated !== null) {
      res.setHeader("x-obfuscated", xObfuscated);
    }
    // Forward any other x- prefixed metadata headers the SPA may rely on,
    // except security headers (x-frame-options, x-xss-protection, etc.).
    for (const [key, value] of upstream.headers.entries()) {
      if (
        key.startsWith("x-") &&
        key !== "x-frame-options" &&
        key !== "x-xss-protection" &&
        key !== "x-content-type-options" &&
        key !== "x-request-id" &&
        key !== "x-robots-tag"
      ) {
        res.setHeader(key, value);
      }
    }

    // Add permissive CORS so the iframe (same Replit origin) can load cross-origin assets
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Special: rewrite env2.js so VITE_PROXY_A/B point to our server instead of
    // ultracloud.cc — ultracloud only allows Origin: miruro.to, so the browser
    // can't call it directly from our iframe origin. We proxy it ourselves.
    if (rest === "env2.js" && contentType.includes("javascript")) {
      let js = await upstream.text();
      js = js
        .replace(/https:\/\/pro\.ultracloud\.cc\//g, "/api/miruro/ultra/pro/")
        .replace(/https:\/\/pru\.ultracloud\.cc\//g, "/api/miruro/ultra/pru/");
      res.status(upstream.status).send(js);
      return;
    }

    // For CSS: rewrite root-relative url() paths (e.g. font URLs) through our proxy
    if (contentType.includes("text/css")) {
      let css = await upstream.text();
      // url(/path) → url(/api/miruro/pass/path)  (unquoted)
      css = css.replace(/url\(\/(?!\/|api\/miruro\/)/g, `url(${PASS_PREFIX}/`);
      // url('/path') and url("/path")
      css = css.replace(/url\('\/(?!\/|api\/miruro\/)/g, `url('${PASS_PREFIX}/`);
      css = css.replace(/url\("\/(?!\/|api\/miruro\/)/g, `url("${PASS_PREFIX}/`);
      // https://www.miruro.bz/ and https://www.miruro.to/ absolute URLs in CSS
      css = css.replace(new RegExp(`https://www\\.miruro\\.bz/`, "g"), `${PASS_PREFIX}/`);
      css = css.replace(new RegExp(`https://www\\.miruro\\.to/`, "g"), `${PASS_PREFIX}/`);
      res.status(upstream.status).send(css);
      return;
    }

    const buf = await upstream.arrayBuffer();
    res.status(upstream.status).send(Buffer.from(buf));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: `Proxy error: ${msg}` });
  }
});

/**
 * GET /api/miruro/ultra/:subdomain/*path
 *
 * Proxies ultracloud.cc streaming API calls.  The Miruro SPA calls
 * https://pro.ultracloud.cc/... and https://pru.ultracloud.cc/... but those
 * endpoints only allow Origin: miruro.to.  We rewrite env2.js to point the
 * proxy URLs here, then forward the requests server-side with the correct
 * Origin header and return permissive CORS to the browser.
 */
const ULTRACLOUD_HOSTS: Record<string, string> = {
  pro: "https://pro.ultracloud.cc",
  pru: "https://pru.ultracloud.cc",
};

// Use router.use instead of router.all with path params to avoid Express 5's
// path-to-regexp v8 automatic URL-decoding of wildcard segments.  The encoded
// stream IDs contain base64url characters (_) and XOR'd bytes that confuse the
// built-in decoder, causing 400 responses before our handler runs.
// Inside the handler, req.path is the remaining path after /miruro/ultra.
router.use("/miruro/ultra", async (req, res, next) => {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.status(204).end();
    return;
  }

  // req.path = /pro/<encoded>~~anon/pl.m3u8 (relative to /miruro/ultra mount point)
  const pathStr = req.path.replace(/^\//, ""); // remove leading slash
  const firstSlash = pathStr.indexOf("/");
  const subdomain = firstSlash >= 0 ? pathStr.slice(0, firstSlash) : pathStr;
  const rest = firstSlash >= 0 ? pathStr.slice(firstSlash + 1) : "";

  const upstreamBase = ULTRACLOUD_HOSTS[subdomain];
  if (!upstreamBase) {
    void next(); // fall through to 404
    return;
  }

  // Preserve query string from the original URL
  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const upstreamUrl = `${upstreamBase}/${rest}${search}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        "User-Agent": ASSET_HEADERS["User-Agent"],
        "Accept": "application/json, text/plain, */*",
        "Accept-Encoding": "identity",
        "Origin": MIRURO_ORIGIN,
        "Referer": MIRURO_ORIGIN + "/",
        ...(req.headers["content-type"]
          ? { "Content-Type": req.headers["content-type"] as string }
          : {}),
      },
      body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
    });

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Content-Type", contentType);

    if (req.method === "HEAD") {
      res.status(upstream.status).end();
      return;
    }

    const buf = await upstream.arrayBuffer();
    res.status(upstream.status).send(Buffer.from(buf));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: `Ultracloud proxy error: ${msg}` });
  }
});

/**
 * GET /api/miruro/proxy?url=https://www.miruro.to/...
 *
 * Fetches the Miruro watch page and:
 * 1. Strips X-Frame-Options / CSP so it can be iframed
 * 2. Rewrites ALL asset URLs (src, href, url()) to go via /api/miruro/pass/
 *    so that relative imports inside JS bundles also resolve through our proxy
 * 3. Injects history.replaceState so the SPA router sees the correct path
 */
router.get("/miruro/proxy", async (req, res) => {
  const rawUrl = (req.query.url as string | undefined)?.trim();

  if (!rawUrl) {
    res.status(400).json({ error: "url query param is required" });
    return;
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  if (!targetUrl.hostname.endsWith("miruro.bz") && !targetUrl.hostname.endsWith("miruro.to")) {
    res.status(400).json({ error: "Only miruro URLs are allowed" });
    return;
  }

  try {
    // Fetch the HTML page and env2.js in parallel so we can inline env2.js
    // synchronously. This is critical: env2.js sets window.env (VITE_PROXY_A/B,
    // VITE_PIPE_OBF_KEY etc.), and the SPA's module bundle reads these values at
    // module-evaluation time. If env2.js is "defer"d it may run AFTER the module
    // bundle, leaving window.env unset → decryption key _a = null → sources
    // request returns empty → YouTube trailer instead of episode.
    const [upstream, env2Upstream] = await Promise.all([
      fetch(targetUrl.toString(), { headers: PAGE_HEADERS }),
      fetch(`${MIRURO_ORIGIN}/env2.js`, { headers: ASSET_HEADERS }).catch(() => null),
    ]);

    const contentType = upstream.headers.get("content-type") ?? "text/html";

    if (!contentType.includes("text/html")) {
      // Non-HTML: forward as-is
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Access-Control-Allow-Origin", "*");
      const buf = await upstream.arrayBuffer();
      res.send(Buffer.from(buf));
      return;
    }

    // Build the inlined env2.js content with our proxy URL rewrites applied.
    // We replace VITE_PROXY_A/B to point at our server instead of ultracloud.cc
    // directly — ultracloud blocks browser cross-origin requests.
    let env2Inline = "";
    if (env2Upstream?.ok) {
      let env2js = await env2Upstream.text();
      env2js = env2js
        .replace(/https:\/\/pro\.ultracloud\.cc\//g, "/api/miruro/ultra/pro/")
        .replace(/https:\/\/pru\.ultracloud\.cc\//g, "/api/miruro/ultra/pru/");
      env2Inline = env2js;
    }

    let html = await upstream.text();

    // ── Rewrite asset URLs ──────────────────────────────────────────────────
    // Replace https://www.miruro.to/<path> → /api/miruro/pass/<path>
    html = html.replace(
      new RegExp(`https://www\\.miruro\\.to/`, "g"),
      `${PASS_PREFIX}/`,
    );

    // Replace root-relative paths /foo → /api/miruro/pass/foo
    // Handles src="/...", href="/...", url(/...) but not protocol-relative "//"
    html = html
      .replace(/(src|href)="\/(?!\/|api\/miruro\/)/g, `$1="${PASS_PREFIX}/`)
      .replace(/(src|href)='\/(?!\/|api\/miruro\/)/g, `$1='${PASS_PREFIX}/`)
      .replace(/url\(\/(?!\/|api\/miruro\/)/g, `url(${PASS_PREFIX}/`);

    // Remove the deferred env2.js script tag — we inline it synchronously below
    // so window.env is set before any module/defer scripts evaluate.
    html = html.replace(/<script[^>]+env2\.js[^>]*><\/script>/gi, "");

    // ── SPA router fix + fetch interceptor ──────────────────────────────────
    // 1. Inline env2.js SYNCHRONOUSLY so window.env is set before module scripts.
    // 2. history.replaceState so the SPA initialises with the correct path.
    // 3. Monkey-patch fetch/XHR so cross-origin calls to miruro.to go through
    //    our server-side pass-through proxy (avoids CORS blocks on API calls).
    // 4. Block service worker registration (the miruro SW tries to precache
    //    files at root paths like /assets/vidstack-*.js that don't exist on
    //    our server, flooding the console with 404s and crashing workbox).
    const originalPath = targetUrl.pathname + targetUrl.search;
    const PASS = PASS_PREFIX; // e.g. /api/miruro/pass
    const routerFix = `<style id="na-player-only">
/* Hide Miruro header/nav/bookmark chrome — applied server-side before React mounts */
header,nav,footer,
[role="banner"],[role="navigation"],
[class*="_header_"],[class*="_nav_"],[class*="_topbar_"],[class*="_navbar_"],
[class*="_notification_"],[class*="_banner_"],[class*="_bookmark_"],
[class*="Header"],[class*="Topbar"],[class*="Navbar"],[class*="Notification"]{
  display:none!important;
}
html,body{margin:0!important;padding:0!important;overflow:hidden!important;background:#000!important}
/* Hide download button in Vidstack player */
media-download-button,
.vds-download-button,
[aria-label="Download"],
[data-media-download-button],
a[download]{
  display:none!important;
}
</style>
<script>
${env2Inline ? `// env2.js inlined synchronously to ensure window.env is set before module scripts\n${env2Inline}` : ""}
(function() {
  try { history.replaceState(null, '', ${JSON.stringify(originalPath)}); } catch(e) {}

  // Block service worker registration — the miruro SW precaches files at root
  // paths (/assets/vidstack-*.js etc.) that don't exist on our proxy server,
  // causing a flood of 404s and breaking workbox, without helping the player.
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

  var MIRURO_ORIGINS = ['https://www.miruro.bz', 'https://miruro.bz', 'https://www.miruro.to', 'https://miruro.to'];
  var PASS = ${JSON.stringify(PASS)};
  var ULTRA_MAP = {
    'https://pro.ultracloud.cc': '/api/miruro/ultra/pro',
    'https://pru.ultracloud.cc': '/api/miruro/ultra/pru',
  };

  function rewriteUrl(url) {
    if (!url || typeof url !== 'string') return url;
    // Redirect ultracloud.cc API calls through our server-side proxy
    for (var k in ULTRA_MAP) {
      if (url.startsWith(k + '/')) return ULTRA_MAP[k] + '/' + url.slice(k.length + 1);
      if (url === k) return ULTRA_MAP[k] + '/';
    }
    // Redirect miruro.to absolute URL calls through our pass-through proxy
    for (var i = 0; i < MIRURO_ORIGINS.length; i++) {
      if (url.startsWith(MIRURO_ORIGINS[i] + '/')) {
        return PASS + '/' + url.slice(MIRURO_ORIGINS[i].length + 1);
      }
      if (url.startsWith(MIRURO_ORIGINS[i])) {
        return PASS + '/';
      }
    }
    // Redirect root-relative /api/ calls — the Miruro SPA calls its own backend
    // at /api/secure/pipe, /api/secure/jwks, /api/monkey, /api/events etc.
    // Those root-relative paths would hit our server and 404; route them through
    // the pass-through proxy so they reach https://www.miruro.bz/api/...
    // Guard: don't redirect URLs that already go through our proxy.
    if ((url.startsWith('/api/') || url === '/api') && !url.startsWith('/api/miruro/')) {
      return PASS + url;
    }
    // Redirect other known root-level paths the SPA fetches directly:
    // /health — server health check; failing this shows "Server unreachable..."
    //           toast permanently and prevents secure-crypto initialisation,
    //           which in turn prevents the encrypted /api/secure/pipe call that
    //           actually fetches episode sources.
    // /random-pool.json — random anime pool used by the randomiser button.
    if (url.startsWith('/health') || url.startsWith('/random-pool.json')) {
      return PASS + url;
    }
    return url;
  }

  // Patch fetch
  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') {
      input = rewriteUrl(input);
    } else if (input instanceof Request) {
      var newUrl = rewriteUrl(input.url);
      if (newUrl !== input.url) input = new Request(newUrl, input);
    }
    return _fetch.call(this, input, init);
  };

  // Patch XMLHttpRequest
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    var args = Array.prototype.slice.call(arguments);
    args[1] = rewriteUrl(String(url));
    return _open.apply(this, args);
  };

  // Patch EventSource (used for /api/events SSE connection)
  if (window.EventSource) {
    var _EventSource = window.EventSource;
    window.EventSource = function(url, init) {
      return new _EventSource(rewriteUrl(String(url)), init);
    };
    window.EventSource.prototype = _EventSource.prototype;
  }

  // Patch navigator.sendBeacon (/api/monkey analytics POSTs)
  if (navigator.sendBeacon) {
    var _sendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      return _sendBeacon(rewriteUrl(String(url)), data);
    };
  }

  // Auto-play helper: mute video so autoplay is not blocked by the browser's
  // "no-user-gesture" policy inside the nested iframe.
  var _playOrig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function() {
    this.muted = true;
    return _playOrig.call(this);
  };

  // ── Player-only mode: hide Miruro chrome, show only the video player ────────
  // Inject immediate CSS to suppress header/nav before React renders.
  var _naStyle = document.createElement('style');
  _naStyle.textContent =
    'header,nav,footer,[role="banner"],[role="navigation"]{display:none!important}' +
    'html,body{margin:0;padding:0;overflow:hidden;background:#000}';
  document.head.appendChild(_naStyle);

  function _naIsolatePlayer() {
    // Miruro uses Vidstack — its root is a <media-player> custom element.
    // Fallback: walk up from <video> to the first large-enough container.
    var player = document.querySelector('media-player') ||
                 document.querySelector('[data-media-player]');
    if (!player) {
      var video = document.querySelector('video');
      if (!video) return false;
      var el = video;
      while (el.parentElement && el.parentElement !== document.body) {
        el = el.parentElement;
        if (el.offsetWidth > 300 && el.offsetHeight > 150) { player = el; break; }
      }
      if (!player) return false;
    }
    // Lift the player to cover the whole iframe viewport.
    player.removeAttribute('style');
    player.style.cssText =
      'position:fixed!important;top:0!important;left:0!important;' +
      'width:100vw!important;height:100vh!important;z-index:2147483647!important;' +
      'background:#000!important;border-radius:0!important;margin:0!important;';
    document.body.style.cssText = 'margin:0;padding:0;background:#000;overflow:hidden';
    document.documentElement.style.cssText = 'height:100%;overflow:hidden;background:#000';
    return true;
  }

  // Try immediately then watch — MutationObserver catches React mounting the player.
  if (!_naIsolatePlayer()) {
    var _naObs = new MutationObserver(function() {
      if (_naIsolatePlayer()) _naObs.disconnect();
    });
    _naObs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(_naIsolatePlayer, 500);
    setTimeout(_naIsolatePlayer, 1500);
    setTimeout(_naIsolatePlayer, 4000);
  }
})();
</script>`;

    if (html.includes("<head>")) {
      html = html.replace("<head>", `<head>${routerFix}`);
    } else {
      html = html.replace(/<head[^>]*>/, (m) => `${m}${routerFix}`);
    }

    // Serve without X-Frame-Options or Content-Security-Policy
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(html);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: `Failed to proxy Miruro: ${msg}` });
  }
});

/**
 * GET /api/miruro/stream?anilistId=...&ep=...&romajiTitle=...
 *
 * Returns a proxy URL for miruro.to that bypasses X-Frame-Options.
 */
router.get("/miruro/stream", async (req, res) => {
  const anilistId = (req.query.anilistId as string | undefined)?.trim();
  const ep = (req.query.ep as string | undefined)?.trim();
  const romajiTitle = (req.query.romajiTitle as string | undefined)?.trim();

  if (!anilistId || !ep) {
    res.status(400).json({ error: "anilistId and ep query params are required" });
    return;
  }

  const epNum = parseInt(ep);
  if (isNaN(epNum) || epNum <= 0) {
    res.status(400).json({ error: `Invalid ep value: "${ep}"` });
    return;
  }

  const slug = romajiTitle ? toMiruroSlug(romajiTitle) : null;
  const miruroUrl = slug
    ? `${MIRURO_ORIGIN}/watch/${anilistId}/${slug}?ep=${epNum}`
    : `${MIRURO_ORIGIN}/watch/${anilistId}?ep=${epNum}`;

  // Build an absolute URL so this works in all deployment environments
  // (Render, Replit prod, etc.) where the frontend and API may be on
  // different origins. A relative path would resolve to the static frontend
  // server which has no /api routes and returns 404 for the iframe src.
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? (req.socket && (req.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.headers.host ?? "localhost:8080";
  const iframeUrl = `${proto}://${host}/api/miruro/proxy?url=${encodeURIComponent(miruroUrl)}`;
  res.json({ iframeUrl });
});

export default router;

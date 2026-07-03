import { Router } from "express";
import { getCfSession, invalidateCfSession, warmCfSession } from "../lib/miruro-cf-solver.js";
import { isMiruroRelayConfigured, relayFetch } from "../lib/miruro-relay.js";

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

/** Base UA/language headers used as fallback when no CF session is available */
const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * Fetch a miruro.bz URL with CF session cookies injected.
 * On 403 (session expired / IP rotated), invalidates cache and retries once.
 */
async function miruroFetch(url: string, init: RequestInit = {}): Promise<Response> {
  // When a relay (e.g. deployed on Render, an IP Cloudflare doesn't block) is
  // configured, skip CloakBrowser/CF-cookie logic entirely — the relay does a
  // plain fetch from a non-blocked IP and just works.
  if (isMiruroRelayConfigured()) {
    return relayFetch(url, init);
  }

  const addSession = async (extraInit: RequestInit): Promise<RequestInit> => {
    const session = await getCfSession();
    if (!session) return extraInit;
    const existing = (extraInit.headers ?? {}) as Record<string, string>;
    return {
      ...extraInit,
      headers: {
        ...existing,
        Cookie: session.cookieHeader,
        "User-Agent": session.userAgent,
      },
    };
  };

  const firstInit = await addSession(init);
  const resp = await fetch(url, firstInit);

  if (resp.status === 403 || resp.status === 429) {
    invalidateCfSession();
    const retryInit = await addSession(init); // triggers a fresh solve
    return fetch(url, retryInit);
  }
  return resp;
}

const PAGE_HEADERS = {
  ...BASE_HEADERS,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  Referer: MIRURO_ORIGIN,
};

// Warm up a CF session in the background at server start so the first
// user request to Miruro doesn't pay the full browser-launch latency.
// Skip entirely when a relay is configured — the relay bypasses the CF
// block via a non-blocked IP, so there's no challenge to solve here.
if (!isMiruroRelayConfigured()) {
  warmCfSession();
}

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
    const upstream = await miruroFetch(upstreamUrl, {
      method: req.method,
      headers: {
        ...BASE_HEADERS,
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
    const ultraHeaders = {
      "User-Agent": BASE_HEADERS["User-Agent"],
      "Accept": "application/json, text/plain, */*",
      "Accept-Encoding": "identity",
      "Origin": MIRURO_ORIGIN,
      "Referer": MIRURO_ORIGIN + "/",
      ...(req.headers["content-type"]
        ? { "Content-Type": req.headers["content-type"] as string }
        : {}),
    };
    const upstream = isMiruroRelayConfigured()
      ? await relayFetch(upstreamUrl, { method: req.method, headers: ultraHeaders })
      : await fetch(upstreamUrl, {
          method: req.method,
          headers: ultraHeaders,
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
/** Return an HTML error page that postMessages the error to the parent frame,
 *  so the watch page overlay can display it instead of raw JSON in the iframe. */
function miruroProxyErrorHtml(message: string): string {
  const safeMsg = message.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const jsonMsg = JSON.stringify(message);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Miruro unavailable</title>
<style>html,body{margin:0;height:100%;background:#0a0a0a;display:flex;align-items:center;justify-content:center;font-family:monospace}
.box{text-align:center;color:#a78bfa;padding:2rem}
.icon{font-size:2rem;margin-bottom:1rem}
p{color:#ffffff80;font-size:.75rem;letter-spacing:.05em;margin:.5rem 0;max-width:280px}</style></head>
<body><div class="box"><div class="icon">⚠</div>
<p>${safeMsg}</p></div>
<script>try{window.parent.postMessage({type:'miruro-proxy-error',error:${jsonMsg}},'*')}catch(e){}</script>
</body></html>`;
}

router.get("/miruro/proxy", async (req, res) => {
  const rawUrl = (req.query.url as string | undefined)?.trim();

  if (!rawUrl) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(400).send(miruroProxyErrorHtml("Invalid proxy request — no URL provided."));
    return;
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(400).send(miruroProxyErrorHtml("Invalid URL provided to Miruro proxy."));
    return;
  }

  if (!targetUrl.hostname.endsWith("miruro.bz") && !targetUrl.hostname.endsWith("miruro.to")) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(400).send(miruroProxyErrorHtml("Only miruro URLs are allowed."));
    return;
  }

  // Read dub preference from the miruro URL itself (set by /miruro/stream)
  const preferDub = targetUrl.searchParams.get("dub") === "true";

  try {
    // Fetch the HTML page and env2.js in parallel so we can inline env2.js
    // synchronously. This is critical: env2.js sets window.env (VITE_PROXY_A/B,
    // VITE_PIPE_OBF_KEY etc.), and the SPA's module bundle reads these values at
    // module-evaluation time. If env2.js is "defer"d it may run AFTER the module
    // bundle, leaving window.env unset → decryption key _a = null → sources
    // request returns empty → YouTube trailer instead of episode.
    const [upstream, env2Upstream] = await Promise.all([
      miruroFetch(targetUrl.toString(), { headers: PAGE_HEADERS }),
      miruroFetch(`${MIRURO_ORIGIN}/env2.js`, { headers: BASE_HEADERS }).catch(() => null),
    ]);

    const contentType = upstream.headers.get("content-type") ?? "text/html";

    // Detect Cloudflare IP block: CF returns 403 with text/html containing
    // its challenge page. If we forward it, the iframe shows a black/CF screen.
    // Return an HTML error page that postMessages the parent to show its overlay.
    if (upstream.status === 403 || upstream.status === 429) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(503).send(miruroProxyErrorHtml("Miruro is currently unavailable from this server (upstream blocked). Please try another server."));
      return;
    }

    if (!contentType.includes("text/html")) {
      // Non-HTML: forward as-is
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Access-Control-Allow-Origin", "*");
      const buf = await upstream.arrayBuffer();
      res.send(Buffer.from(buf));
      return;
    }

    let html = await upstream.text();
    // Belt-and-suspenders: detect CF block pages by body fingerprint
    // (in case CF returns 200 with a JS challenge page)
    if (html.includes("cf-error-details") || html.includes("Cloudflare Ray ID") || html.includes("Sorry, you have been blocked")) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(503).send(miruroProxyErrorHtml("Miruro is currently unavailable from this server (Cloudflare block). Please try another server."));
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

    // Disable download capability in SSR config — Miruro reads __SSR_CONFIG__
    // to decide whether to show the download button per provider. Setting all
    // "download":true → "download":false here prevents the button from ever
    // being rendered by the React app, which is more reliable than CSS/JS hiding.
    // Replace in all formats (with/without spaces, single/double quotes).
    html = html.replace(/"download"\s*:\s*true/g, '"download":false');
    html = html.replace(/'download'\s*:\s*true/g, "'download':false");

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
[aria-label="download" i],
[data-media-download-button],
a[download],
button[data-download],
[class*="download"]{
  display:none!important;
  visibility:hidden!important;
  width:0!important;
  height:0!important;
  pointer-events:none!important;
  overflow:hidden!important;
}
</style>
<script>
${env2Inline ? `// env2.js inlined synchronously to ensure window.env is set before module scripts\n${env2Inline}` : ""}
(function() {
  // ── Disable download buttons via __SSR_CONFIG__ override ────────────────
  // Miruro reads window.__SSR_CONFIG__.streaming[provider].capabilities.download
  // to decide whether to render the download button. Zero it out now (before
  // the inline script that sets it runs) by defining a setter that intercepts
  // the assignment and strips download=true from every provider.
  try {
    var _naSsrRaw = null;
    Object.defineProperty(window, '__SSR_CONFIG__', {
      configurable: true,
      get: function() { return _naSsrRaw; },
      set: function(v) {
        try {
          if (v && v.streaming) {
            var providers = Object.keys(v.streaming);
            for (var p = 0; p < providers.length; p++) {
              var prov = v.streaming[providers[p]];
              if (prov && prov.capabilities) prov.capabilities.download = false;
            }
          }
        } catch(e2) {}
        _naSsrRaw = v;
      }
    });
  } catch(e) {}

  try { history.replaceState(null, '', ${JSON.stringify(originalPath)}); } catch(e) {}

  // ── Audio language: always set miruro's localStorage preference ────────────
  // Miruro stores settings under "miruro:settings:*" keys. Since our proxy
  // runs on its own origin, we must explicitly set the audio pref every load —
  // both for DUB (set to "dub") AND for SUB (set to "sub" / remove stale DUB).
  // Without clearing on SUB, a previous DUB session's localStorage persists.
  (function() {
    var _naAudioVal = ${JSON.stringify(preferDub)} ? JSON.stringify('dub') : JSON.stringify('sub');
    var _naLangKeys = [
      'miruro:settings:lang',
      'miruro:settings:language',
      'miruro:settings:audio',
      'miruro:settings:audioLanguage',
      'miruro:settings:dubLang',
    ];
    for (var _ki = 0; _ki < _naLangKeys.length; _ki++) {
      try { localStorage.setItem(_naLangKeys[_ki], _naAudioVal); } catch(_ke) {}
    }

    // DOM fallback: after React mounts, click the correct audio button.
    // This covers any localStorage key name we may have missed.
    var _naTargetAudio = ${JSON.stringify(preferDub)} ? 'dub' : 'sub';
    function _naClickAudio() {
      var btns = document.querySelectorAll('button,[role="button"]');
      for (var _bi = 0; _bi < btns.length; _bi++) {
        var _bt = (btns[_bi].textContent || '').trim().toLowerCase();
        var _bl = (btns[_bi].getAttribute('aria-label') || '').toLowerCase();
        if (_bt === _naTargetAudio || _bl === _naTargetAudio) {
          try { btns[_bi].click(); return true; } catch(_be) {}
        }
      }
      return false;
    }
    var _naAudioTick = 0;
    var _naAudioTimer = setInterval(function() {
      if (_naClickAudio() || ++_naAudioTick >= 30) clearInterval(_naAudioTimer);
    }, 300);
  })();

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

  // ── Hide download button (Vidstack renders it dynamically after React mounts) ──
  function _naKillEl(el) {
    try {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
      el.style.setProperty('width', '0', 'important');
      el.style.setProperty('height', '0', 'important');
      el.style.setProperty('overflow', 'hidden', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
      el.style.setProperty('max-width', '0', 'important');
      el.style.setProperty('max-height', '0', 'important');
      el.style.setProperty('opacity', '0', 'important');
      el.style.setProperty('position', 'absolute', 'important');
      // Mark so we don't keep reprocessing it
      el.setAttribute('data-na-hidden', '1');
    } catch(e) {}
  }
  function _naHideDownload() {
    // 1. Selector-based: cover Vidstack web-component names + data attrs + raw download anchors
    var sels = [
      'media-download-button',
      '.vds-download-button',
      '[data-media-download-button]',
      'a[download]',
    ];
    for (var s = 0; s < sels.length; s++) {
      try {
        var els = document.querySelectorAll(sels[s]);
        for (var e = 0; e < els.length; e++) _naKillEl(els[e]);
      } catch(ex) {}
    }
    // 2. Broad scan: check aria-label AND title attributes on all interactive elements.
    //    Vidstack v2 uses aria-label; older/custom builds use title; cover both.
    try {
      var all = document.querySelectorAll('button,a,[role="button"],media-download-button,[class*="download"]');
      for (var i = 0; i < all.length; i++) {
        var lbl = (all[i].getAttribute('aria-label') || '').toLowerCase();
        var ttl = (all[i].getAttribute('title') || '').toLowerCase();
        var txt = (all[i].textContent || '').trim().toLowerCase();
        if (
          lbl.indexOf('download') !== -1 ||
          ttl.indexOf('download') !== -1 ||
          (txt === 'download' && all[i].tagName !== 'BODY')
        ) {
          _naKillEl(all[i]);
        }
      }
    } catch(e3) {}
    // 3. Inject a dynamic <style> block that targets whatever class Vidstack assigns.
    //    Re-inject if it was removed by React's hydration pass.
    try {
      if (!document.getElementById('na-dl-css')) {
        var st = document.createElement('style');
        st.id = 'na-dl-css';
        st.textContent =
          'media-download-button,[data-media-download-button],.vds-download-button,' +
          'a[download],button[aria-label*="ownload" i],a[aria-label*="ownload" i],' +
          '[title*="ownload" i],[class*="download"]{' +
          'display:none!important;visibility:hidden!important;width:0!important;' +
          'height:0!important;overflow:hidden!important;opacity:0!important;' +
          'pointer-events:none!important;max-width:0!important;max-height:0!important}';
        (document.head || document.documentElement).appendChild(st);
      }
    } catch(e4) {}
  }
  _naHideDownload();
  // MutationObserver: fires whenever Vidstack re-renders or hydrates controls
  var _naDlObs = new MutationObserver(_naHideDownload);
  _naDlObs.observe(document.documentElement, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['aria-label', 'title', 'download', 'class'],
  });
  // Interval for 30s to catch anything that slips through the observer
  var _naDlTick = 0;
  var _naDlInterval = setInterval(function() {
    _naHideDownload();
    if (++_naDlTick >= 60) clearInterval(_naDlInterval);
  }, 500);
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
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(502).send(miruroProxyErrorHtml(`Failed to proxy Miruro: ${msg}`));
  }
});

/**
 * GET /api/miruro/direct-url?anilistId=...&ep=...&romajiTitle=...
 *
 * Returns the *real* miruro.bz watch URL — no server-side fetch, no CF
 * session, no relay involved. Meant to be opened directly in the user's own
 * browser tab/popup (window.open), not embedded in an iframe. Since the
 * request happens from the visitor's real browser/IP instead of our
 * server, Cloudflare treats it as a normal visitor and the challenge
 * resolves the same way it would for any other site visit — this sidesteps
 * both the server-IP block and miruro's X-Frame-Options restriction (which
 * only blocks framing, not top-level navigation).
 */
router.get("/miruro/direct-url", (req, res) => {
  const anilistId = (req.query.anilistId as string | undefined)?.trim();
  const ep = (req.query.ep as string | undefined)?.trim();
  const romajiTitle = (req.query.romajiTitle as string | undefined)?.trim();
  const preferDub = (req.query.dub as string | undefined) === "1";

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
  const dubSuffix = preferDub ? "&dub=true" : "";
  const url = slug
    ? `${MIRURO_ORIGIN}/watch/${anilistId}/${slug}?ep=${epNum}${dubSuffix}`
    : `${MIRURO_ORIGIN}/watch/${anilistId}?ep=${epNum}${dubSuffix}`;

  res.json({ url });
});

/**
 * GET /api/miruro/stream?anilistId=...&ep=...&romajiTitle=...
 *
 * Returns a proxy URL for miruro.bz that bypasses X-Frame-Options.
 * Uses getCfSession() to verify a valid CF session exists before handing
 * back the iframeUrl — if CF can't be solved, returns 503 so the frontend
 * shows the "Under Maintenance" overlay and auto-switches servers.
 */
router.get("/miruro/stream", async (req, res) => {
  const anilistId = (req.query.anilistId as string | undefined)?.trim();
  const ep = (req.query.ep as string | undefined)?.trim();
  const romajiTitle = (req.query.romajiTitle as string | undefined)?.trim();
  const preferDub = (req.query.dub as string | undefined) === "1";

  if (!anilistId || !ep) {
    res.status(400).json({ error: "anilistId and ep query params are required" });
    return;
  }

  const epNum = parseInt(ep);
  if (isNaN(epNum) || epNum <= 0) {
    res.status(400).json({ error: `Invalid ep value: "${ep}"` });
    return;
  }

  // When a relay is configured, skip CF session — the relay fetches from a
  // non-Replit IP that Cloudflare doesn't block, so no browser session is needed.
  if (!isMiruroRelayConfigured()) {
    // Ensure a valid CF session exists before returning the iframe URL.
    // getCfSession() launches CloakBrowser to solve CF if no cached session.
    // If it returns null (binary not yet downloaded / solve failed), report unavailable.
    const session = await getCfSession();
    if (!session) {
      res.status(503).json({ error: "Miruro is temporarily unavailable — CF session could not be established. Please try another server." });
      return;
    }
  }

  const slug = romajiTitle ? toMiruroSlug(romajiTitle) : null;
  const dubSuffix = preferDub ? "&dub=true" : "";
  const miruroUrl = slug
    ? `${MIRURO_ORIGIN}/watch/${anilistId}/${slug}?ep=${epNum}${dubSuffix}`
    : `${MIRURO_ORIGIN}/watch/${anilistId}?ep=${epNum}${dubSuffix}`;

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

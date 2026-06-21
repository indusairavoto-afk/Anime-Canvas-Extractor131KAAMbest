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
 * GET /api/comix/find?title=<manga title>
 *
 * Fetches comix.to's home page SSR data (which embeds ~100 trending/popular manga
 * with their HIDs and URLs) and tries to match the requested title. Returns the
 * comix.to title path if found so the frontend can open the SSR-rendered title page
 * instead of the broken SPA browse/search page.
 */
router.get("/comix/find", async (req, res) => {
  const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  try {
    const homeRes = await fetch(`${COMIX_ORIGIN}/`, {
      headers: {
        ...HEADERS,
        Accept: "text/html,application/xhtml+xml",
        Referer: COMIX_ORIGIN + "/",
      },
    });

    if (!homeRes.ok) {
      res.json({ found: false });
      return;
    }

    const homeHtml = await homeRes.text();
    const m = homeHtml.match(/id="initial-data">(\{[\s\S]+?\})<\/script>/);
    if (!m) {
      res.json({ found: false });
      return;
    }

    const data = JSON.parse(m[1]) as {
      queries?: Record<string, unknown>;
    };

    type ComixManga = {
      hid: string;
      title: string;
      altTitles?: string[];
      url: string;
    };

    const allManga: ComixManga[] = [];
    for (const val of Object.values(data.queries ?? {})) {
      if (Array.isArray(val)) {
        for (const item of val as unknown[]) {
          const it = item as Record<string, unknown>;
          if (it && typeof it.hid === "string" && typeof it.title === "string" && typeof it.url === "string") {
            allManga.push({
              hid: it.hid,
              title: it.title,
              altTitles: Array.isArray(it.altTitles) ? (it.altTitles as string[]) : [],
              url: it.url,
            });
          }
        }
      }
    }

    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

    const q = normalize(title);

    function titlesMatch(a: string, b: string): boolean {
      if (!a || !b || a.length < 2 || b.length < 2) return false;
      if (a === b) return true;
      // Only accept substring match when the shorter title is at least 5 chars
      // (avoids false positives from short normalized strings)
      const shorter = a.length < b.length ? a : b;
      const longer = a.length < b.length ? b : a;
      return shorter.length >= 5 && longer.includes(shorter);
    }

    let best: ComixManga | null = null;
    for (const manga of allManga) {
      const t = normalize(manga.title);
      if (titlesMatch(t, q)) { best = manga; break; }
      for (const alt of manga.altTitles ?? []) {
        const a = normalize(alt);
        if (titlesMatch(a, q)) { best = manga; break; }
      }
      if (best) break;
    }

    if (best) {
      res.json({ found: true, url: best.url, hid: best.hid, title: best.title });
    } else {
      res.json({ found: false });
    }
  } catch (err: unknown) {
    req.log.error(err);
    res.json({ found: false });
  }
});

/**
 * Builds the JavaScript + CSS injection for the comix.to proxy pages.
 * Rewrites ALL root-relative fetch/XHR calls through the pass proxy so the
 * SPA's TanStack Query refetches (e.g. /browse?search=...) hit comix.to
 * instead of our own server.
 */
function buildInjection(PASS: string, COMIX: string, extraCss = ""): string {
  return `<style id="na-comix-hide">
header,nav,footer,
[role="banner"],[role="navigation"],[role="contentinfo"],
[class*="header"],[class*="Header"],
[class*="navbar"],[class*="Navbar"],
[class*="topbar"],[class*="Topbar"],
[class*="top-bar"],[class*="TopBar"],
[class*="sidebar"],[class*="Sidebar"],
[class*="footer"],[class*="Footer"],
[class*="modal-backdrop"],
[class*="cookie"],[class*="Cookie"],
[class*="banner"],[class*="Banner"],
[class*="popup"],[class*="Popup"],
[class*="notification"],[class*="Notification"],
[class*="toast"],[class*="Toast"],
[class*="ad-"],[class*="-ad"],[class*="advert"],
[id*="ad-"],[id*="-ad"],[id*="advert"],
#header,#nav,#navbar,#topbar,#footer,#sidebar {
  display: none !important;
}
html,body {
  padding-top: 0 !important;
  margin-top: 0 !important;
  background: #0a0a0a !important;
}
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: #111; }
::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #555; }
${extraCss}
</style>
<script>
(function() {
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
    /* Absolute comix.to URLs */
    if (url.startsWith(COMIX + '/')) return PASS + '/' + url.slice(COMIX.length + 1);
    if (url === COMIX) return PASS + '/';
    /* Leave our own proxy paths alone */
    if (url.startsWith('/api/comix/')) return url;
    /* Rewrite ALL other root-relative paths through the pass proxy so the
       SPA's data fetches (e.g. /browse?search=...) hit comix.to */
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

  /* Intercept link clicks — keep navigation inside the reader */
  document.addEventListener('click', function(e) {
    var el = e.target && e.target.closest && e.target.closest('a');
    if (!el) return;
    var href = el.getAttribute('href');
    if (!href) return;
    if (href.startsWith('http') && !href.startsWith(COMIX) && !href.startsWith(PASS)) return;
    e.preventDefault();
    var path = href.startsWith(COMIX) ? href.slice(COMIX.length) : href;
    if (path.startsWith(PASS)) path = '/' + path.slice(PASS.length);
    window.location.href = '/api/comix/reader?path=' + encodeURIComponent(path);
  }, true);
})();
</script>`;
}

function injectIntoHtml(html: string, injection: string): string {
  return html.includes("<head>")
    ? html.replace("<head>", "<head>" + injection)
    : injection + html;
}

function rewriteHtmlUrls(html: string): string {
  return html
    .replace(/https:\/\/comix\.to\//g, `${PASS_PREFIX}/`)
    .replace(/(src|href)="\/(?!\/|api\/comix\/)/g, `$1="${PASS_PREFIX}/`)
    .replace(/(src|href)='\/(?!\/|api\/comix\/)/g, `$1='${PASS_PREFIX}/`)
    .replace(/url\(\/(?!\/|api\/comix\/)/g, `url(${PASS_PREFIX}/`);
}

/**
 * GET /api/comix/proxy?path=<comix.to path>
 *
 * Fetches a comix.to HTML page, rewrites asset/API URLs and injects the pass proxy
 * script. Intended for browsing comix.to within an embedded context.
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
      res.status(upstream.status).send(
        `<html><body style="background:#111;color:#fff;font-family:monospace;padding:2rem">comix.to returned ${upstream.status} for ${path}</body></html>`
      );
      return;
    }

    let html = rewriteHtmlUrls(await upstream.text());
    html = injectIntoHtml(html, buildInjection(PASS_PREFIX, COMIX_ORIGIN));

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

/**
 * GET /api/comix/reader?path=<comix.to path>
 *
 * Like /comix/proxy but intended for the in-app reader overlay — same URL rewriting
 * and injection so the SPA can make its data fetches through the pass proxy.
 */
router.get("/comix/reader", async (req, res) => {
  const path =
    typeof req.query.path === "string" ? req.query.path : "/";
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
      res.status(upstream.status).send(
        `<html><body style="background:#0a0a0a;color:#fff;font-family:monospace;padding:2rem">comix.to returned ${upstream.status}</body></html>`
      );
      return;
    }

    let html = rewriteHtmlUrls(await upstream.text());
    html = injectIntoHtml(html, buildInjection(PASS_PREFIX, COMIX_ORIGIN));

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.send(html);
  } catch (err: unknown) {
    req.log.error(err);
    res.status(502).send(
      `<html><body style="background:#0a0a0a;color:#fff;font-family:monospace;padding:2rem">Failed to load manga reader</body></html>`
    );
  }
});

export default router;

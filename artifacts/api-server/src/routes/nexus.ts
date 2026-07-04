import { Router } from "express";

const router = Router();

const NEXUS_ORIGIN = "https://anime.nexus";
const NEXUS_API = "https://api.anime.nexus";
const PASS_PREFIX = "/api/nexus/pass";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

const PAGE_HEADERS = {
  ...BROWSER_HEADERS,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  Referer: NEXUS_ORIGIN + "/",
};

/**
 * Resolve an AniList ID to an anime.nexus series UUID + slug by scraping
 * the series page with ?anilist_id=<id>. anime.nexus embeds the series UUID
 * in <link rel="canonical"> or redirect when a matching show is found.
 * Returns null when the show is not in their catalogue.
 */
async function resolveNexusId(anilistId: string): Promise<{ uuid: string; slug: string } | null> {
  try {
    // Fetch the series list filtered by AniList ID — the server redirects or
    // renders a page with the canonical series URL in its <link rel="canonical">
    const resp = await fetch(`${NEXUS_ORIGIN}/series?anilist_id=${encodeURIComponent(anilistId)}`, {
      headers: PAGE_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;

    // If the server redirected straight to the series page, parse that URL
    const finalUrl = resp.url;
    const redirectMatch = finalUrl.match(/\/series\/([0-9a-f-]{36})\/([^/?#]+)/);
    if (redirectMatch) {
      return { uuid: redirectMatch[1], slug: redirectMatch[2] };
    }

    const html = await resp.text();

    // Look for the canonical URL embedded in the HTML
    const canonicalMatch = html.match(/<link[^>]+rel="canonical"[^>]+href="https?:\/\/anime\.nexus\/series\/([0-9a-f-]{36})\/([^"/?#]+)"/i);
    if (canonicalMatch) {
      return { uuid: canonicalMatch[1], slug: canonicalMatch[2] };
    }

    // Look for a series link in the page body (series listing result)
    const bodyMatch = html.match(/href="\/series\/([0-9a-f-]{36})\/([^"/?#]+)"/);
    if (bodyMatch) {
      return { uuid: bodyMatch[1], slug: bodyMatch[2] };
    }

    // Parse the og:url as final fallback
    const ogMatch = html.match(/<meta[^>]+property="og:url"[^>]+content="https?:\/\/anime\.nexus\/series\/([0-9a-f-]{36})\/([^"/?#]+)"/i);
    if (ogMatch) {
      return { uuid: ogMatch[1], slug: ogMatch[2] };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve an episode UUID + slug for a given series UUID and episode number.
 * Scrapes the series page SSR data which embeds episode list information.
 */
async function resolveEpisode(seriesUuid: string, seriesSlug: string, epNum: number): Promise<{ uuid: string; slug: string } | null> {
  try {
    const resp = await fetch(`${NEXUS_ORIGIN}/series/${seriesUuid}/${seriesSlug}`, {
      headers: PAGE_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;

    const html = await resp.text();

    // The series page SSR embeds episode data in the TSR script as watch URLs
    // Pattern: watch/{uuid}/{slug} where slug starts with the episode title
    // We look for the episode by its number in the data
    const watchPattern = /watch\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([a-z0-9-]+)/g;
    // Also try to find number:N next to uuid
    const numberPattern = new RegExp(`"number":${epNum}[,}]`, "g");

    // Strategy 1: find episode in structured SSR data blocks like {id:"...",slug:"...",number:N}
    const epBlockRe = /id:"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"[^}]*?slug:"([^"]+)"[^}]*?number:(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = epBlockRe.exec(html)) !== null) {
      if (parseInt(m[3]) === epNum) {
        return { uuid: m[1], slug: m[2] };
      }
    }

    // Strategy 2: find watch URLs and pick by proximity to episode number
    const watchUrls: { uuid: string; slug: string; index: number }[] = [];
    let wm: RegExpExecArray | null;
    while ((wm = watchPattern.exec(html)) !== null) {
      watchUrls.push({ uuid: wm[1], slug: wm[2], index: wm.index });
    }

    // Find number:N positions and pick the closest watch URL
    let nm: RegExpExecArray | null;
    let bestMatch: { uuid: string; slug: string } | null = null;
    let bestDist = Infinity;
    while ((nm = numberPattern.exec(html)) !== null) {
      for (const w of watchUrls) {
        const dist = Math.abs(w.index - nm.index);
        if (dist < bestDist) {
          bestDist = dist;
          bestMatch = { uuid: w.uuid, slug: w.slug };
        }
      }
    }
    if (bestMatch && bestDist < 500) return bestMatch;

    // Strategy 3: if only one episode is on the page (single-episode series), return it
    if (watchUrls.length === 1) return watchUrls[0];

    return null;
  } catch {
    return null;
  }
}

/**
 * GET /api/nexus/pass/*path
 *
 * Wildcard pass-through proxy for all anime.nexus assets and API calls.
 * Removes X-Frame-Options, CSP, and forwards the correct Origin/Referer headers.
 * Routes starting with "api." go to api.anime.nexus; everything else to anime.nexus.
 */
router.all("/nexus/pass/*path", async (req, res) => {
  const rawPath = (req.params as Record<string, string | string[]>).path;
  const rest = (Array.isArray(rawPath) ? rawPath.join("/") : rawPath ?? "").replace(/^\//, "");
  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";

  // Paths prefixed with "api/" go to api.anime.nexus, rest to anime.nexus
  let upstreamUrl: string;
  if (rest.startsWith("_api/")) {
    upstreamUrl = `${NEXUS_API}/${rest.slice(5)}${search}`;
  } else {
    upstreamUrl = `${NEXUS_ORIGIN}/${rest}${search}`;
  }

  try {
    const isPost = req.method === "POST" || req.method === "PUT" || req.method === "PATCH";
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        ...BROWSER_HEADERS,
        Accept: req.headers["accept"] as string || "*/*",
        Origin: NEXUS_ORIGIN,
        Referer: NEXUS_ORIGIN + "/",
        ...(req.headers["content-type"] ? { "Content-Type": req.headers["content-type"] as string } : {}),
        // Forward cookies so authenticated API calls work
        ...(req.headers["cookie"] ? { Cookie: req.headers["cookie"] as string } : {}),
        ...(req.headers["authorization"] ? { Authorization: req.headers["authorization"] as string } : {}),
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
      },
      body: isPost ? req : undefined,
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const cacheControl = upstream.headers.get("cache-control");

    // Strip security headers, add permissive CORS
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    // Forward set-cookie so authenticated sessions persist in the iframe
    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) res.setHeader("Set-Cookie", setCookie);

    // Cache strategy: no-store for API, normal caching for assets
    if (rest.startsWith("_api/") || upstreamUrl.includes("/api/")) {
      res.setHeader("Cache-Control", "no-store, no-cache");
      res.setHeader("Pragma", "no-cache");
    } else if (cacheControl) {
      res.setHeader("Cache-Control", cacheControl);
    } else {
      res.setHeader("Cache-Control", "public, max-age=86400");
    }

    // Forward relevant x- headers
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

    // Rewrite CSS url() paths
    if (contentType.includes("text/css")) {
      let css = await upstream.text();
      css = css.replace(/url\(\/(?!\/|api\/nexus\/)/g, `url(${PASS_PREFIX}/`);
      css = css.replace(/url\('\/(?!\/|api\/nexus\/)/g, `url('${PASS_PREFIX}/`);
      css = css.replace(/url\("\/(?!\/|api\/nexus\/)/g, `url("${PASS_PREFIX}/`);
      css = css.replace(new RegExp(`https://anime\\.nexus/`, "g"), `${PASS_PREFIX}/`);
      res.status(upstream.status).send(css);
      return;
    }

    if (req.method === "HEAD") {
      res.status(upstream.status).end();
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
 * OPTIONS preflight for pass-through
 */
router.options("/nexus/pass/*path", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.status(204).end();
});

/**
 * GET /api/nexus/proxy?url=...
 *
 * Fetches an anime.nexus watch page and:
 * 1. Strips X-Frame-Options / CSP so it can be iframed
 * 2. Rewrites all asset URLs through /api/nexus/pass/
 * 3. Injects a fetch/XHR interceptor to redirect API calls through our proxy
 * 4. Hides the site chrome (header/nav/sidebar) leaving only the player
 * 5. Blocks service worker registration
 */
router.get("/nexus/proxy", async (req, res) => {
  const rawUrl = (req.query.url as string | undefined)?.trim();
  if (!rawUrl) { res.status(400).json({ error: "url query param required" }); return; }

  let targetUrl: URL;
  try { targetUrl = new URL(rawUrl); } catch { res.status(400).json({ error: "Invalid URL" }); return; }

  if (!targetUrl.hostname.endsWith("anime.nexus")) {
    res.status(400).json({ error: "Only anime.nexus URLs are allowed" });
    return;
  }

  try {
    const upstream = await fetch(targetUrl.toString(), {
      headers: PAGE_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });

    const contentType = upstream.headers.get("content-type") ?? "text/html";
    if (!contentType.includes("text/html")) {
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Access-Control-Allow-Origin", "*");
      const buf = await upstream.arrayBuffer();
      res.send(Buffer.from(buf));
      return;
    }

    let html = await upstream.text();

    // ── Rewrite asset URLs ──────────────────────────────────────────────────
    // Absolute anime.nexus URLs → pass-through proxy
    html = html.replace(new RegExp(`https://anime\\.nexus/`, "g"), `${PASS_PREFIX}/`);

    // Root-relative paths → pass-through proxy
    html = html
      .replace(/(src|href)="\/(?!\/|api\/nexus\/)/g, `$1="${PASS_PREFIX}/`)
      .replace(/(src|href)='\/(?!\/|api\/nexus\/)/g, `$1='${PASS_PREFIX}/`)
      .replace(/url\(\/(?!\/|api\/nexus\/)/g, `url(${PASS_PREFIX}/`);

    // ── Inject interceptors ──────────────────────────────────────────────────
    // JSON.stringify does NOT escape "</" by default, so a value containing a
    // literal "</script" sequence in the path could prematurely close our
    // wrapping <script> tag, leaking injected JS as visible page text.
    // Escape it defensively for every value interpolated into the script block.
    const jsStringLiteral = (value: string): string =>
      JSON.stringify(value).replace(/<\/script/gi, "<\\/script");
    const originalPath = targetUrl.pathname + targetUrl.search;
    const PASS = PASS_PREFIX;

    const injection = `<style id="na-nexus-player-only">
html,body{margin:0!important;padding:0!important;overflow:hidden!important;background:#000!important}
header,nav,footer,aside,
[class*="header"],[class*="Header"],
[class*="sidebar"],[class*="Sidebar"],
[class*="nav"],[class*="Nav"],
[class*="topbar"],[class*="Topbar"],
[class*="navbar"],[class*="Navbar"]{
  display:none!important;
}
/* Force player to fill viewport */
[class*="player"],[class*="Player"],
video-player,media-player,
[data-media-player]{
  position:fixed!important;top:0!important;left:0!important;
  width:100vw!important;height:100vh!important;
  z-index:2147483647!important;
  background:#000!important;
}
</style>
<script>
(function(){
  try { history.replaceState(null,'',${jsStringLiteral(originalPath)}); } catch(e){}

  // Block service worker — would try to precache from root paths that 404 on our proxy
  try {
    Object.defineProperty(navigator,'serviceWorker',{
      value:{
        register:function(){return Promise.resolve({scope:'/',active:null});},
        ready:Promise.resolve({scope:'/',active:null}),
        controller:null,
        getRegistrations:function(){return Promise.resolve([]);},
        getRegistration:function(){return Promise.resolve(undefined);},
        addEventListener:function(){},removeEventListener:function(){},
      },configurable:true
    });
  } catch(e){}

  var NEXUS_ORIGINS=['https://anime.nexus','http://anime.nexus'];
  var API_ORIGIN='https://api.anime.nexus';
  var PASS=${JSON.stringify(PASS)};

  function rewriteUrl(url){
    if(!url||typeof url!=='string') return url;
    // api.anime.nexus → pass-through under _api/ prefix
    if(url.startsWith(API_ORIGIN+'/')){
      return PASS+'/_api/'+url.slice(API_ORIGIN.length+1);
    }
    if(url===API_ORIGIN) return PASS+'/_api/';
    // anime.nexus absolute
    for(var i=0;i<NEXUS_ORIGINS.length;i++){
      if(url.startsWith(NEXUS_ORIGINS[i]+'/')){
        return PASS+'/'+url.slice(NEXUS_ORIGINS[i].length+1);
      }
      if(url===NEXUS_ORIGINS[i]) return PASS+'/';
    }
    // watch.delivery video CDN — pass through directly (Cloudflare will handle auth)
    // Root-relative /api/ calls go to anime.nexus API
    if(url.startsWith('/api/')&&!url.startsWith('/api/nexus/')){
      return PASS+'/_api'+url;
    }
    // Other root-relative assets
    if(url.startsWith('/')&&!url.startsWith('/api/nexus/')){
      return PASS+url;
    }
    return url;
  }

  var _fetch=window.fetch;
  window.fetch=function(input,init){
    if(typeof input==='string') input=rewriteUrl(input);
    else if(input instanceof Request){
      var nu=rewriteUrl(input.url);
      if(nu!==input.url) input=new Request(nu,input);
    }
    return _fetch.call(this,input,init);
  };

  var _open=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url){
    var args=Array.prototype.slice.call(arguments);
    args[1]=rewriteUrl(String(url));
    return _open.apply(this,args);
  };

  if(window.EventSource){
    var _ES=window.EventSource;
    window.EventSource=function(url,init){return new _ES(rewriteUrl(String(url)),init);};
    window.EventSource.prototype=_ES.prototype;
  }
  if(navigator.sendBeacon){
    var _sb=navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon=function(url,data){return _sb(rewriteUrl(String(url)),data);};
  }

  // Auto-mute to avoid autoplay block inside iframe
  var _play=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){this.muted=true;return _play.call(this);};

  function _naIsolatePlayer(){
    var player=document.querySelector('video-player,[data-media-player],[class*="PlayerWrapper"],[class*="player-wrapper"]');
    if(!player){
      var video=document.querySelector('video');
      if(!video) return false;
      var el=video;
      while(el.parentElement&&el.parentElement!==document.body){
        el=el.parentElement;
        if(el.offsetWidth>300&&el.offsetHeight>150){player=el;break;}
      }
      if(!player) return false;
    }
    player.removeAttribute('style');
    player.style.cssText='position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;background:#000!important;border-radius:0!important;margin:0!important;';
    document.body.style.cssText='margin:0;padding:0;background:#000;overflow:hidden';
    document.documentElement.style.cssText='height:100%;overflow:hidden;background:#000';
    return true;
  }

  if(!_naIsolatePlayer()){
    var _obs=new MutationObserver(function(){if(_naIsolatePlayer())_obs.disconnect();});
    _obs.observe(document.documentElement,{childList:true,subtree:true});
    setTimeout(_naIsolatePlayer,500);
    setTimeout(_naIsolatePlayer,1500);
    setTimeout(_naIsolatePlayer,4000);
  }
})();
</script>`;

    if (html.includes("<head>")) {
      html = html.replace("<head>", `<head>${injection}`);
    } else {
      html = html.replace(/<head[^>]*>/, (m) => `${m}${injection}`);
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(html);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: `Failed to proxy anime.nexus: ${msg}` });
  }
});

/**
 * GET /api/nexus/stream?anilistId=...&ep=...
 *
 * Resolves the anime.nexus watch URL for a given AniList ID and episode number,
 * then returns a proxy iframe URL that bypasses X-Frame-Options.
 */
router.get("/nexus/stream", async (req, res) => {
  const anilistId = (req.query.anilistId as string | undefined)?.trim();
  const ep = (req.query.ep as string | undefined)?.trim();

  if (!anilistId || !ep) {
    res.status(400).json({ error: "anilistId and ep query params required" });
    return;
  }

  const epNum = parseInt(ep);
  if (isNaN(epNum) || epNum <= 0) {
    res.status(400).json({ error: `Invalid ep: "${ep}"` });
    return;
  }

  // Step 1: resolve AniList ID → anime.nexus series UUID
  const series = await resolveNexusId(anilistId);
  if (!series) {
    res.status(404).json({ error: "Anime not found on anime.nexus" });
    return;
  }

  // Step 2: resolve series + episode number → episode UUID + slug
  const episode = await resolveEpisode(series.uuid, series.slug, epNum);

  // Build the watch URL — with episode UUID if found, else direct series link
  let watchUrl: string;
  if (episode) {
    watchUrl = `${NEXUS_ORIGIN}/watch/${episode.uuid}/${episode.slug}`;
  } else {
    // Fallback: link to series page with episode number as query
    watchUrl = `${NEXUS_ORIGIN}/series/${series.uuid}/${series.slug}`;
  }

  // Build absolute proxy URL
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)
    ?? ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.headers.host ?? "localhost:8080";
  const iframeUrl = `${proto}://${host}/api/nexus/proxy?url=${encodeURIComponent(watchUrl)}`;

  res.json({ iframeUrl, seriesUuid: series.uuid, episodeUuid: episode?.uuid ?? null, watchUrl });
});

export default router;

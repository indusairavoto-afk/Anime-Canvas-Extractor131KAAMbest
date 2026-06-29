import { Router } from "express";

const router = Router();

const SHIROKO_ORIGIN = "https://shiroko.co";
const PASS_PREFIX = "/api/shiroko/pass";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": SHIROKO_ORIGIN + "/",
  "Origin": SHIROKO_ORIGIN,
};

// Known providers on shiroko.co
export const SHIROKO_PROVIDERS = [
  { id: "zen",        label: "Zen"        },
  { id: "hianime",   label: "HiAnime"    },
  { id: "gogoanime", label: "GogoAnime"  },
  { id: "animepahe", label: "AnimePahe"  },
  { id: "animerulz", label: "AnimeRulz"  },
];

/**
 * GET /api/shiroko/pass/*path
 * Pass-through proxy for all shiroko.co assets and API calls.
 * Strips X-Frame-Options so the page can be embedded.
 */
router.all("/shiroko/pass/*path", async (req, res) => {
  const rawPath = (req.params as Record<string, string | string[]>).path;
  const rest = (Array.isArray(rawPath) ? rawPath.join("/") : rawPath ?? "").replace(/^\//, "");
  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const upstreamUrl = `${SHIROKO_ORIGIN}/${rest}${search}`;

  try {
    const isPost = req.method === "POST" || req.method === "PUT" || req.method === "PATCH";
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        ...BROWSER_HEADERS,
        Accept: (req.headers["accept"] as string) || "*/*",
        ...(req.headers["content-type"] ? { "Content-Type": req.headers["content-type"] as string } : {}),
        ...(req.headers["cookie"] ? { Cookie: req.headers["cookie"] as string } : {}),
        ...(req.headers["authorization"] ? { Authorization: req.headers["authorization"] as string } : {}),
      },
      body: isPost ? req : undefined,
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) res.setHeader("Set-Cookie", setCookie);

    const cacheControl = upstream.headers.get("cache-control");
    if (cacheControl) {
      res.setHeader("Cache-Control", cacheControl);
    } else {
      res.setHeader("Cache-Control", "public, max-age=86400");
    }

    if (contentType.includes("text/css")) {
      let css = await upstream.text();
      css = css.replace(/url\(\/(?!\/|api\/shiroko\/)/g, `url(${PASS_PREFIX}/`);
      css = css.replace(new RegExp(`https://shiroko\\.co/`, "g"), `${PASS_PREFIX}/`);
      res.status(upstream.status).send(css);
      return;
    }

    if (req.method === "HEAD") { res.status(upstream.status).end(); return; }

    const buf = await upstream.arrayBuffer();
    res.status(upstream.status).send(Buffer.from(buf));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: `Proxy error: ${msg}` });
  }
});

router.options("/shiroko/pass/*path", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.status(204).end();
});

/**
 * GET /api/shiroko/proxy?url=...
 * Fetches a shiroko.co watch page, strips X-Frame-Options / CSP,
 * rewrites asset URLs through /api/shiroko/pass/, injects player-isolation script.
 */
router.get("/shiroko/proxy", async (req, res) => {
  const rawUrl = (req.query.url as string | undefined)?.trim();
  if (!rawUrl) { res.status(400).json({ error: "url query param required" }); return; }

  let targetUrl: URL;
  try { targetUrl = new URL(rawUrl); } catch { res.status(400).json({ error: "Invalid URL" }); return; }

  if (!targetUrl.hostname.endsWith("shiroko.co")) {
    res.status(400).json({ error: "Only shiroko.co URLs are allowed" });
    return;
  }

  try {
    const upstream = await fetch(targetUrl.toString(), {
      headers: {
        ...BROWSER_HEADERS,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });

    let html = await upstream.text();

    // Rewrite absolute shiroko.co URLs → pass-through proxy
    html = html.replace(new RegExp(`https://shiroko\\.co/`, "g"), `${PASS_PREFIX}/`);

    // Rewrite root-relative paths
    html = html
      .replace(/(src|href)="\/(?!\/|api\/shiroko\/)/g, `$1="${PASS_PREFIX}/`)
      .replace(/(src|href)='\/(?!\/|api\/shiroko\/)/g, `$1='${PASS_PREFIX}/`)
      .replace(/url\(\/(?!\/|api\/shiroko\/)/g, `url(${PASS_PREFIX}/`);

    const originalSearch = targetUrl.search;
    const PASS = PASS_PREFIX;

    const injection = `<style id="na-shiroko-player-only">
html,body{margin:0!important;padding:0!important;overflow:hidden!important;background:#000!important}
header,nav,footer,aside,
[class*="header"],[class*="Header"],
[class*="sidebar"],[class*="Sidebar"],
[class*="nav"],[class*="Nav"],
[class*="topbar"],[class*="Topbar"],
[class*="navbar"],[class*="Navbar"],
[class*="toolbar"],[class*="Toolbar"]{display:none!important}
[class*="player"],[class*="Player"],
video,[class*="video"],[class*="Video"]{
  position:fixed!important;top:0!important;left:0!important;
  width:100vw!important;height:100vh!important;
  z-index:2147483647!important;background:#000!important;
}
</style>
<script>
(function(){
  try{history.replaceState(null,'',${JSON.stringify("/watch" + originalSearch)});}catch(e){}

  // Block service worker
  try{
    Object.defineProperty(navigator,'serviceWorker',{
      value:{register:function(){return Promise.resolve({});},ready:Promise.resolve({}),
      controller:null,getRegistrations:function(){return Promise.resolve([]);},
      getRegistration:function(){return Promise.resolve(undefined);},
      addEventListener:function(){},removeEventListener:function(){}},configurable:true});
  }catch(e){}

  var PASS=${JSON.stringify(PASS)};
  var SH_ORIGIN='https://shiroko.co';

  function rewriteUrl(url){
    if(!url||typeof url!=='string') return url;
    if(url.startsWith(SH_ORIGIN+'/')) return PASS+'/'+url.slice(SH_ORIGIN.length+1);
    if(url===SH_ORIGIN) return PASS+'/';
    if(url.startsWith('/')&&!url.startsWith('/api/shiroko/')) return PASS+url;
    return url;
  }

  var _fetch=window.fetch;
  window.fetch=function(input,init){
    if(typeof input==='string') input=rewriteUrl(input);
    else if(input instanceof Request){var nu=rewriteUrl(input.url);if(nu!==input.url)input=new Request(nu,input);}
    return _fetch.call(this,input,init);
  };

  var _open=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url){
    var args=Array.prototype.slice.call(arguments);
    args[1]=rewriteUrl(String(url));
    return _open.apply(this,args);
  };

  // Auto-hide chrome after React hydration
  function isolatePlayer(){
    var video=document.querySelector('video');
    if(!video) return false;
    var el=video;
    while(el.parentElement&&el.parentElement!==document.body){
      el=el.parentElement;
      if(el.offsetWidth>200&&el.offsetHeight>100){break;}
    }
    el.style.cssText='position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;background:#000!important;border-radius:0!important;margin:0!important;';
    document.body.style.cssText='margin:0;padding:0;background:#000;overflow:hidden';
    document.documentElement.style.cssText='height:100%;overflow:hidden;background:#000';
    return true;
  }
  if(!isolatePlayer()){
    var obs=new MutationObserver(function(){if(isolatePlayer())obs.disconnect();});
    obs.observe(document.documentElement,{childList:true,subtree:true});
    [500,1500,3000,5000].forEach(function(t){setTimeout(isolatePlayer,t);});
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
    res.status(502).json({ error: `Failed to proxy shiroko.co: ${msg}` });
  }
});

/**
 * GET /api/shiroko/stream?anilistId=...&ep=...&dub=...&provider=...
 * Returns a proxy iframe URL for the given AniList ID + episode.
 * shiroko.co uses AniList IDs directly — no resolution needed.
 */
router.get("/shiroko/stream", async (req, res) => {
  const anilistId = (req.query.anilistId as string | undefined)?.trim();
  const ep = (req.query.ep as string | undefined)?.trim();
  const dub = (req.query.dub as string | undefined) === "true";
  const provider = ((req.query.provider as string | undefined)?.trim()) || "zen";

  if (!anilistId || !ep) {
    res.status(400).json({ error: "anilistId and ep query params required" });
    return;
  }

  const epNum = parseInt(ep);
  if (isNaN(epNum) || epNum <= 0) {
    res.status(400).json({ error: `Invalid ep: "${ep}"` });
    return;
  }

  const watchUrl = `${SHIROKO_ORIGIN}/watch?id=${encodeURIComponent(anilistId)}&n=${epNum}&dub=${dub}&provider=${encodeURIComponent(provider)}`;

  const proto = (req.headers["x-forwarded-proto"] as string | undefined)
    ?? ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.headers.host ?? "localhost:8080";
  const iframeUrl = `${proto}://${host}/api/shiroko/proxy?url=${encodeURIComponent(watchUrl)}`;

  res.json({ iframeUrl, watchUrl, provider });
});

export default router;

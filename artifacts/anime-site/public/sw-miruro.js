/**
 * sw-miruro.js — Service Worker CF bypass for miruro.bz
 *
 * Problem: Replit's server IP is hard-blocked by Cloudflare on miruro.bz.
 * Solution: The user's browser IP is NOT blocked. This SW intercepts iframe
 * navigations to /miruro-sw/* and proxies them to www.miruro.bz using the
 * browser's own IP, stripping X-Frame-Options/CSP so the page can be framed.
 *
 * Ultracloud.cc CDN calls are routed through /api/miruro/ultra/ (server-side)
 * since ultracloud.cc is NOT CF-blocked from Replit — only miruro.bz itself is.
 */

const MIRURO_ORIGIN = 'https://www.miruro.bz';
const MIRURO_HOSTNAMES = new Set(['www.miruro.bz', 'miruro.bz', 'www.miruro.to', 'miruro.to']);
const SW_PREFIX = '/miruro-sw';
const VERSION = 'v8';

/**
 * CDN hostnames used by Miruro's video providers (kiwi, etc.).
 * These CDNs block Replit's server IP (so the server-side proxy fails), but
 * they allow user-browser IPs.  The SW intercepts fetches to these hostnames,
 * forwards them with the correct Referer/Origin context, and adds
 * Access-Control-Allow-Origin: * so the in-page HLS player can read the data.
 */
const CDN_SUFFIXES = ['.uwucdn.top', '.owocdn.top'];

/** Response headers that would block the iframe or cause CORS issues */
const DROP_RESP_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
]);

self.addEventListener('install', () => {
  // Take control immediately — don't wait for old SW to die
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Primary: intercept /miruro-sw/* (our proxy path)
  if (url.pathname.startsWith(SW_PREFIX + '/')) {
    event.respondWith(handleProxy(event.request, url));
    return;
  }

  // Secondary: intercept direct miruro.bz navigations that originate from pages
  // we control (e.g. CF post-challenge redirect back to the real miruro URL).
  // Rewrite to go through our SW proxy so X-Frame-Options is stripped.
  if (MIRURO_HOSTNAMES.has(url.hostname)) {
    const proxyUrl = new URL(SW_PREFIX + url.pathname + url.search, self.location.origin);
    event.respondWith(handleProxy(new Request(proxyUrl, { method: event.request.method, headers: event.request.headers }), proxyUrl));
    return;
  }

  // Tertiary: intercept Miruro CDN requests (uwucdn.top, owocdn.top, etc.).
  // These CDNs block Replit's server IP so the server-side /api/anizone/hls
  // proxy fails.  However, the user's browser IP is NOT blocked.  We intercept
  // here so we can (a) use the browser's IP for the actual fetch and (b) inject
  // Access-Control-Allow-Origin: * so the HLS player can read the response.
  const isMiruroCdn = CDN_SUFFIXES.some(function(sfx) { return url.hostname === sfx.slice(1) || url.hostname.endsWith(sfx); });
  if (isMiruroCdn) {
    event.respondWith(handleCdnProxy(event.request, url));
  }
});

/**
 * Main proxy handler. Fetches from miruro.bz using the browser's IP
 * (which is not CF-blocked), then transforms the response.
 */
async function handleProxy(request, url) {
  const miruroPath = url.pathname.slice(SW_PREFIX.length); // /watch/123/slug
  const miruroUrl = MIRURO_ORIGIN + miruroPath + url.search;
  const method = request.method;

  try {
    // For non-GET/HEAD, forward body
    let body;
    if (method !== 'GET' && method !== 'HEAD') {
      try { body = await request.arrayBuffer(); } catch (_) { body = undefined; }
    }

    const isApiCall = miruroPath.startsWith('/api/');

    // API calls (/api/secure/pipe, /api/secure/jwks, etc.):
    // Use credentials:'omit' — the pipe endpoint is purely crypto-authenticated
    // (encrypted 'e' param from JWKS) and doesn't need a session cookie.
    // The relay (which the server uses) also sends no cookies and works fine.
    // 'include' was tried before but fails CORS because miruro.bz requires
    // Access-Control-Allow-Credentials:true for credentialed cross-origin
    // requests, which it doesn't send for third-party origins.
    // 'omit' only needs Access-Control-Allow-Origin:* which public API
    // endpoints commonly support. If CORS still fails, we notify the parent
    // directly via clients.matchAll() (not via HTML body which never executes
    // scripts when returned as a fetch response, only as an iframe navigation).
    let upstream;
    if (isApiCall) {
      try {
        upstream = await fetch(miruroUrl, {
          method,
          headers: buildUpstreamHeaders(request, true),
          body,
          credentials: 'omit',
        });
      } catch (apiErr) {
        // CORS/network failure on API call — notify parent frame directly.
        // swFailedResponse HTML won't work here because the SPA is doing a
        // fetch() call (not a navigation), so <script> tags never execute.
        const apiMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
        console.warn('[sw-miruro] API call CORS failure for', miruroPath, ':', apiMsg);
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
          .then(function(clients) {
            clients.forEach(function(c) {
              c.postMessage({ type: 'miruro-sw-failed', error: apiMsg });
            });
          });
        return new Response(JSON.stringify({ error: apiMsg, source: 'sw-cors' }), {
          status: 503,
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
        });
      }
    } else {
      upstream = await fetch(miruroUrl, {
        method,
        headers: buildUpstreamHeaders(request, false),
        body,
        credentials: 'omit',
      });
    }

    const ct = upstream.headers.get('content-type') || '';
    const newHeaders = buildDownstreamHeaders(upstream.headers);

    // ── env2.js: rewrite ultracloud.cc → our server proxy ──────────────────
    // ultracloud.cc blocks browser cross-origin requests; our server proxy
    // (/api/miruro/ultra/) forwards with the correct Origin: miruro.bz header.
    // ultracloud.cc is NOT CF-blocked from Replit, so this always works.
    if (miruroPath === '/env2.js') {
      let js = await upstream.text();
      js = js
        .replace(/https:\/\/pro\.ultracloud\.cc\//g, '/api/miruro/ultra/pro/')
        .replace(/https:\/\/pru\.ultracloud\.cc\//g, '/api/miruro/ultra/pru/');
      newHeaders.set('content-type', 'application/javascript; charset=utf-8');
      return new Response(js, { status: upstream.status, headers: newHeaders });
    }

    // ── HTML: full rewrite + interceptor injection ──────────────────────────
    if (ct.includes('text/html')) {
      let html = await upstream.text();

      // Hard CF block — unrecoverable, notify parent overlay immediately.
      // Use precise markers only: cf-error-details is a CF-specific CSS class that
      // only appears on error pages, and "Sorry, you have been blocked" is CF's hard
      // block message. Avoid "Cloudflare Ray ID" — it can appear in analytics scripts
      // on normal pages, causing false positives that wrongly surface "Server IP Blocked".
      if (
        html.includes('cf-error-details') ||
        html.includes('Sorry, you have been blocked')
      ) {
        return cfBlockResponse();
      }

      // Soft CF challenge ("Just a moment…") — pass it through so the user can
      // solve the Turnstile/JS challenge inside the iframe. Inject a redirect
      // interceptor so CF's post-solve navigation (to https://www.miruro.bz/...)
      // is rewritten to go through our /miruro-sw/ proxy instead of hitting
      // miruro.bz directly (which would be blocked by X-Frame-Options).
      if (html.includes('Just a moment')) {
        const redirectInterceptor = `<script>
(function(){
  var SW='/miruro-sw';
  var MORIG=['https://www.miruro.bz','https://miruro.bz','https://www.miruro.to','https://miruro.to'];
  function rewriteToProxy(href){
    for(var i=0;i<MORIG.length;i++){
      if(href.startsWith(MORIG[i])){
        return SW+href.slice(MORIG[i].length);
      }
    }
    return null;
  }
  // Intercept location.href / location.replace / location.assign
  var _replace=location.replace.bind(location);
  var _assign=location.assign.bind(location);
  try{
    Object.defineProperty(location,'href',{
      set:function(v){var p=rewriteToProxy(v);if(p){_replace(p);}else{_replace(v);}}
    });
  }catch(e){}
  location.replace=function(v){var p=rewriteToProxy(v);_replace(p||v);};
  location.assign=function(v){var p=rewriteToProxy(v);_assign(p||v);};
  // Intercept history navigation used by CF challenge completion
  var _push=history.pushState.bind(history);
  var _rep=history.replaceState.bind(history);
  history.pushState=function(s,t,u){if(u){var p=rewriteToProxy(u);if(p)return _rep(s,t,p);}return _push(s,t,u);};
  history.replaceState=function(s,t,u){if(u){var p=rewriteToProxy(u);if(p)return _rep(s,t,p);}return _rep(s,t,u);};
})();
</script>`;
        html = redirectInterceptor + html;
        newHeaders.set('content-type', 'text/html; charset=utf-8');
        return new Response(html, { status: upstream.status, headers: newHeaders });
      }

      // Rewrite absolute miruro.bz URLs → SW-proxied paths
      html = html
        .replace(/https:\/\/www\.miruro\.bz\//g, SW_PREFIX + '/')
        .replace(/https:\/\/miruro\.bz\//g, SW_PREFIX + '/')
        .replace(/https:\/\/www\.miruro\.to\//g, SW_PREFIX + '/')
        .replace(/https:\/\/miruro\.to\//g, SW_PREFIX + '/');

      // Rewrite root-relative src/href attrs → SW-proxied paths
      // Guard: don't double-rewrite already-rewritten paths or /api/miruro/ paths
      html = html
        .replace(/(src|href)="\/(?!\/|miruro-sw\/|api\/)([^"]*)"/g, `$1="${SW_PREFIX}/$2"`)
        .replace(/(src|href)='\/(?!\/|miruro-sw\/|api\/)([^']*)'/g, `$1='${SW_PREFIX}/$2'`);

      // Disable download capability in SSR config
      html = html.replace(/"download"\s*:\s*true/g, '"download":false');

      // Inject our interceptor script before </head>
      const inject = buildInjectionScript(miruroPath, url.search);
      if (html.includes('</head>')) {
        html = html.replace('</head>', inject + '</head>');
      } else {
        html = html.replace(/<body/i, inject + '<body');
      }

      newHeaders.set('content-type', 'text/html; charset=utf-8');
      return new Response(html, { status: upstream.status, headers: newHeaders });
    }

    // ── CSS: rewrite root-relative url() references ────────────────────────
    if (ct.includes('text/css')) {
      let css = await upstream.text();
      css = css
        .replace(/url\(\/(?!\/|miruro-sw\/|api\/)/g, `url(${SW_PREFIX}/`)
        .replace(/url\('\/(?!\/|miruro-sw\/|api\/)/g, `url('${SW_PREFIX}/`)
        .replace(/url\("\/(?!\/|miruro-sw\/|api\/)/g, `url("${SW_PREFIX}/`)
        .replace(/https:\/\/www\.miruro\.bz\//g, SW_PREFIX + '/')
        .replace(/https:\/\/www\.miruro\.to\//g, SW_PREFIX + '/');
      return new Response(css, { status: upstream.status, headers: newHeaders });
    }

    // ── All other resources: pass through ──────────────────────────────────
    return new Response(upstream.body, { status: upstream.status, headers: newHeaders });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[sw-miruro] proxy error for', miruroPath, ':', msg);
    if (err instanceof TypeError) {
      if (isApiCall) {
        // API call CORS failure — notify parent via clients (not HTML body which
        // never executes its <script> when returned as a fetch response).
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
          .then(function(clients) {
            clients.forEach(function(c) {
              c.postMessage({ type: 'miruro-sw-failed', error: msg });
            });
          });
        return new Response(JSON.stringify({ error: msg, source: 'sw-cors' }), {
          status: 503,
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
        });
      }
      // Navigation/asset failure — return swFailedResponse HTML whose <script> WILL
      // execute because this response is served as an iframe navigation, not a fetch.
      return swFailedResponse(msg);
    }
    return cfBlockResponse(msg);
  }
}

/**
 * CDN proxy handler for uwucdn.top / owocdn.top.
 *
 * Miruro's kiwi provider uses these CDNs.  Replit's server IP is CF-blocked so
 * our server-side /api/anizone/hls proxy fails with a CF challenge page.
 * The user's browser IP is NOT blocked, so we fetch directly here (SW runs in
 * the user's browser).  We then inject ACAO: * so the in-page HLS player can
 * read the response regardless of our page's origin.
 *
 * We forward Referer and Accept from the original request.  We cannot set
 * Origin (forbidden header) so the browser sends its own origin, but CDNs
 * that block by IP (not origin) will still respond with real content.
 */
async function handleCdnProxy(request, url) {
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Referer': MIRURO_ORIGIN + '/',
      'Accept': request.headers.get('accept') || '*/*',
    };
    const resp = await fetch(url.toString(), {
      method: request.method,
      headers: headers,
      credentials: 'omit',
    });

    // If the CDN returned an HTML page (CF challenge / error), fail loudly so
    // HLS.js gets an error response rather than trying to parse HTML as m3u8.
    // CF challenge pages come back as HTTP 200 text/html — check regardless of
    // status code, because any HTML from a CDN video endpoint is wrong.
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('text/html')) {
      return new Response(JSON.stringify({ error: 'CDN blocked (HTML response)', status: resp.status }), {
        status: 503,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      });
    }

    // Copy upstream headers, override ACAO so the page can read the response.
    const newHeaders = new Headers();
    for (const [k, v] of resp.headers.entries()) {
      if (k.toLowerCase() !== 'access-control-allow-origin') newHeaders.set(k, v);
    }
    newHeaders.set('access-control-allow-origin', '*');
    newHeaders.set('access-control-allow-headers', '*');

    return new Response(resp.body, { status: resp.status, headers: newHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    });
  }
}

/** Build request headers for upstream miruro.bz fetch */
function buildUpstreamHeaders(request, isApiCall) {
  const h = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': MIRURO_ORIGIN,
    'Referer': MIRURO_ORIGIN + '/',
  };
  const accept = request.headers.get('accept');
  if (accept) h['Accept'] = accept;
  const ct = request.headers.get('content-type');
  if (ct) h['Content-Type'] = ct;
  return h;
}

/** Build response headers: copy upstream, drop security restrictions, add CORS */
function buildDownstreamHeaders(upstreamHeaders) {
  const h = new Headers();
  for (const [k, v] of upstreamHeaders.entries()) {
    if (!DROP_RESP_HEADERS.has(k.toLowerCase())) h.set(k, v);
  }
  h.set('access-control-allow-origin', '*');
  h.set('access-control-allow-headers', '*');
  h.set('access-control-allow-methods', 'GET, POST, HEAD, OPTIONS');
  // Preserve x-obfuscated — miruro SPA uses it to decide XOR decryption mode
  // (already preserved since we copy all non-blocked headers above)
  return h;
}

/**
 * Signals the parent watch page that the SW cannot proxy miruro.bz from this
 * app's origin — typically because miruro.bz doesn't return CORS headers for
 * cross-origin fetch() calls.  This is a SW limitation, not a CF IP block.
 * The parent handles this by setting swFailed=true and falling back to the
 * server-side relay or openMiruroDirect.
 */
function swFailedResponse(detail) {
  const jsonDetail = JSON.stringify(detail || 'SW CORS/network error');
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
try{window.parent.postMessage({type:'miruro-sw-failed',error:${jsonDetail}},'*');}catch(e){}
</script></body></html>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

/** Error page that notifies the parent frame via postMessage */
function cfBlockResponse(detail) {
  const msg = detail
    ? 'Miruro CF block (SW): ' + detail
    : 'Miruro is currently unavailable from your browser (Cloudflare challenge). Try the direct link.';
  const safeMsg = msg.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const jsonMsg = JSON.stringify(msg);
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;background:#0a0a0a;display:flex;align-items:center;justify-content:center;font-family:monospace}
.b{text-align:center;color:#a78bfa;padding:2rem}.i{font-size:2rem;margin-bottom:1rem}
p{color:#ffffff80;font-size:.75rem;max-width:280px;margin:.5rem auto}</style></head>
<body><div class="b"><div class="i">⚠</div><p>${safeMsg}</p></div>
<script>
try{window.parent.postMessage({type:'miruro-proxy-error',error:${jsonMsg}},'*');}catch(e){}
</script></body></html>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

/**
 * The interceptor script injected into every proxied miruro HTML page.
 *
 * It:
 * 1. Sets history path so the SPA router initialises correctly
 * 2. Rewrites fetch/XHR/EventSource URLs so root-relative /api/* calls go
 *    through the SW (/miruro-sw/api/*) rather than hitting our server
 * 3. Rewrites ultracloud.cc → /api/miruro/ultra/ (server proxy — works fine)
 * 4. Blocks miruro's own SW registration (would try to precache root paths
 *    that don't exist on our server)
 * 5. Mutes autoplay (browser blocks unmuted autoplay without user gesture)
 * 6. Lifts the Vidstack media-player to full viewport
 * 7. Hides download buttons and miruro chrome (header/nav/footer)
 */
function buildInjectionScript(miruroPath, search) {
  // JSON-encode path so it's safe to embed in a <script> tag
  const pathJson = JSON.stringify(miruroPath + search);

  return `<style id="na-sw-css">
header,nav,footer,[role="banner"],[role="navigation"],
[class*="_header_"],[class*="_nav_"],[class*="_topbar_"],[class*="_navbar_"],
[class*="_notification_"],[class*="_banner_"],[class*="_bookmark_"],
[class*="Header"],[class*="Topbar"],[class*="Navbar"],[class*="Notification"]{
  display:none!important;
}
html,body{margin:0!important;padding:0!important;overflow:hidden!important;background:#000!important}
media-download-button,.vds-download-button,[data-media-download-button],a[download],
button[aria-label*="ownload" i],a[aria-label*="ownload" i],
[title*="ownload" i],[class*="download"]{
  display:none!important;visibility:hidden!important;width:0!important;height:0!important;
  pointer-events:none!important;overflow:hidden!important;opacity:0!important;
  max-width:0!important;max-height:0!important;
}
</style>
<script>
(function(){
  var SW='/miruro-sw';
  var ULTRA={
    'https://pro.ultracloud.cc':'/api/miruro/ultra/pro',
    'https://pru.ultracloud.cc':'/api/miruro/ultra/pru'
  };
  var MORIG=[
    'https://www.miruro.bz','https://miruro.bz',
    'https://www.miruro.to','https://miruro.to'
  ];

  function rw(u){
    if(!u||typeof u!=='string')return u;
    // ultracloud.cc → our server proxy (not CF-blocked from Replit)
    for(var k in ULTRA)if(u.startsWith(k+'/'))return ULTRA[k]+'/'+u.slice(k.length+1);
    // absolute miruro.bz URLs → SW-proxied paths
    for(var i=0;i<MORIG.length;i++){
      if(u.startsWith(MORIG[i]+'/'))return SW+'/'+u.slice(MORIG[i].length+1);
      if(u===MORIG[i])return SW+'/';
    }
    // root-relative /api/* → /miruro-sw/api/* (SW proxies to miruro.bz/api/*)
    if((u.startsWith('/api/')||u==='/api')&&!u.startsWith('/api/miruro/'))return SW+u;
    // /health and /random-pool.json → through SW
    if(u.startsWith('/health')||u.startsWith('/random-pool.json'))return SW+u;
    return u;
  }

  // Fix SPA router: needs to see the real watch path, not /miruro-sw/watch/...
  try{history.replaceState(null,'',${pathJson});}catch(e){}

  // Confirm to the parent that real miruro content (not a network-error page)
  // actually loaded and executed inside the iframe. The parent uses this as
  // positive proof-of-life — if it never arrives within its own timeout window,
  // the parent assumes the SW wasn't controlling this navigation yet (the
  // known first-load race condition) and falls back to the legacy relay URL.
  try{window.parent.postMessage({type:'miruro-sw-loaded'},'*');}catch(e){}

  // Confirm actual video playback started — the strongest signal the stream
  // is genuinely working, not just that the page shell rendered.
  try{
    document.addEventListener('playing',function(ev){
      if(ev.target&&ev.target.tagName==='VIDEO'){
        try{window.parent.postMessage({type:'miruro-sw-playing'},'*');}catch(e){}
      }
    },true);
  }catch(e){}

  // Block miruro's own service worker (it precaches root paths that 404 on our server)
  try{
    Object.defineProperty(navigator,'serviceWorker',{
      value:{
        register:function(){return Promise.resolve({scope:'/',active:null,installing:null,waiting:null});},
        ready:Promise.resolve({scope:'/',active:null}),
        controller:null,
        getRegistrations:function(){return Promise.resolve([]);},
        getRegistration:function(){return Promise.resolve(undefined);},
        addEventListener:function(){},
        removeEventListener:function(){},
        dispatchEvent:function(){return false;}
      },
      configurable:true
    });
  }catch(e){}

  // Intercept __SSR_CONFIG__ to disable download button
  try{
    var _nc=null;
    Object.defineProperty(window,'__SSR_CONFIG__',{
      configurable:true,
      get:function(){return _nc;},
      set:function(v){
        try{
          if(v&&v.streaming){
            Object.keys(v.streaming).forEach(function(p){
              if(v.streaming[p]&&v.streaming[p].capabilities)
                v.streaming[p].capabilities.download=false;
            });
          }
        }catch(e2){}
        _nc=v;
      }
    });
  }catch(e){}

  // Patch fetch
  var _f=window.fetch;
  window.fetch=function(inp,init){
    if(typeof inp==='string')inp=rw(inp);
    else if(inp instanceof Request){var nu=rw(inp.url);if(nu!==inp.url)inp=new Request(nu,inp);}
    return _f.call(this,inp,init);
  };

  // Patch XMLHttpRequest
  var _xo=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    var a=Array.prototype.slice.call(arguments);
    a[1]=rw(String(u));
    return _xo.apply(this,a);
  };

  // Patch EventSource (SSE for /api/events)
  if(window.EventSource){
    var _ES=window.EventSource;
    window.EventSource=function(u,i){return new _ES(rw(String(u)),i);};
    window.EventSource.prototype=_ES.prototype;
  }

  // Patch sendBeacon (/api/monkey analytics)
  if(navigator.sendBeacon){
    var _sb=navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon=function(u,d){return _sb(rw(String(u)),d);};
  }

  // Mute autoplay (browser blocks unmuted autoplay without user gesture)
  var _pl=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){this.muted=true;return _pl.call(this);};

  // Lift the Vidstack player to fill the iframe viewport
  function _iso(){
    var p=document.querySelector('media-player,[data-media-player]');
    if(!p){
      var v=document.querySelector('video');
      if(!v)return false;
      var el=v;
      while(el.parentElement&&el.parentElement!==document.body){
        el=el.parentElement;
        if(el.offsetWidth>300&&el.offsetHeight>150){p=el;break;}
      }
      if(!p)return false;
    }
    p.style.cssText='position:fixed!important;top:0!important;left:0!important;'+
      'width:100vw!important;height:100vh!important;z-index:2147483647!important;'+
      'background:#000!important;border-radius:0!important;margin:0!important;';
    document.body.style.cssText='margin:0;padding:0;background:#000;overflow:hidden';
    document.documentElement.style.cssText='height:100%;overflow:hidden;background:#000';
    return true;
  }
  if(!_iso()){
    var _ob=new MutationObserver(function(){if(_iso())_ob.disconnect();});
    _ob.observe(document.documentElement,{childList:true,subtree:true});
    [500,1500,4000].forEach(function(t){setTimeout(_iso,t);});
  }

  // Kill download buttons dynamically (Vidstack renders them after mount)
  function _killEl(el){
    try{
      el.style.setProperty('display','none','important');
      el.style.setProperty('visibility','hidden','important');
      el.style.setProperty('width','0','important');
      el.style.setProperty('height','0','important');
      el.style.setProperty('overflow','hidden','important');
      el.style.setProperty('pointer-events','none','important');
      el.style.setProperty('opacity','0','important');
      el.setAttribute('data-na-hidden','1');
    }catch(e){}
  }
  function _killDl(){
    ['media-download-button','.vds-download-button','[data-media-download-button]','a[download]'].forEach(function(s){
      try{document.querySelectorAll(s).forEach(_killEl);}catch(e){}
    });
    try{
      document.querySelectorAll('button,a,[role="button"],[class*="download"]').forEach(function(el){
        var lbl=(el.getAttribute('aria-label')||'').toLowerCase();
        var ttl=(el.getAttribute('title')||'').toLowerCase();
        var txt=(el.textContent||'').trim().toLowerCase();
        if(lbl.indexOf('download')!==-1||ttl.indexOf('download')!==-1||(txt==='download'&&el.tagName!=='BODY'))_killEl(el);
      });
    }catch(e){}
  }
  _killDl();
  var _dob=new MutationObserver(_killDl);
  _dob.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-label','title','download','class']});

})();
</script>`;
}

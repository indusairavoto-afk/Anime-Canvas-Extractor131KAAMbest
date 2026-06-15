import { Router } from "express";

const router = Router();

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "identity",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

const BLOCKED_RESPONSE_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-content-type-options",
  // We modify the response body (inject scripts/styles), so the upstream
  // Content-Length is always wrong. Dropping it lets Express re-calculate it.
  // Also drop Transfer-Encoding — combining both causes a Node.js parse error.
  "content-length",
  "transfer-encoding",
]);

// Injected into anikoto.cz pages to strip the website chrome and show only the #player div.
// Also intercepts XHR/fetch to route relative AJAX calls through our proxy (avoids CORS).
const KOTO_INJECT = `<style>
html,body{margin:0!important;padding:0!important;background:#000!important;overflow:hidden!important}
body>*{display:none!important;visibility:hidden!important;pointer-events:none!important}
.aside-wrapper{
  display:block!important;visibility:visible!important;pointer-events:all!important;
  position:fixed!important;inset:0!important;z-index:2147483647!important;background:#000!important;
}
aside.main,#w-media,#w-player,#player-wrapper{
  display:block!important;visibility:visible!important;pointer-events:all!important;
  width:100%!important;height:100%!important;padding:0!important;margin:0!important;box-sizing:border-box!important;
}
#player{
  display:block!important;visibility:visible!important;pointer-events:all!important;
  width:100vw!important;height:100vh!important;padding:0!important;margin:0!important;background:#000!important;
}
#player>*{display:block!important;visibility:visible!important;pointer-events:all!important}
#player iframe,#player video{
  position:fixed!important;top:0!important;left:0!important;
  width:100vw!important;height:100vh!important;border:0!important;
  z-index:2147483647!important;display:block!important;visibility:visible!important;
}
#controls{display:none!important;visibility:hidden!important}
a,button,[onclick],[data-bs-toggle]{pointer-events:all!important}
</style>
<script>
(function(){
  /* Route ALL anikoto.cz AJAX calls (relative AND absolute) through our proxy.
     Absolute anikoto.cz URLs would otherwise hit CORS errors in the browser
     because the page is served from our origin, not from anikoto.cz. */
  var K='https://anikoto.cz';
  var P='/api/proxy?url=';
  function fix(u){
    if(!u||typeof u!=='string')return u;
    if(/^(?:data:|blob:)/.test(u))return u;
    /* Absolute anikoto.cz URLs — route through proxy */
    if(/^https?:\/\/anikoto\.cz/i.test(u)||/^\/\/anikoto\.cz/i.test(u)){
      var abs=u.startsWith('//')?'https:'+u:u;
      return P+encodeURIComponent(abs);
    }
    /* Other absolute URLs (CDN players, etc.) — pass through unchanged */
    if(/^https?:\/\//i.test(u)||/^\/\//.test(u))return u;
    /* Relative URLs — resolve against anikoto.cz and proxy */
    var resolved=K+(u.charAt(0)==='/'?'':'/')+u;
    return P+encodeURIComponent(resolved);
  }
  var ox=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    var a=Array.prototype.slice.call(arguments,2);
    return ox.apply(this,[m,fix(String(u||''))].concat(a));
  };
  if(window.fetch){
    var of=window.fetch;
    window.fetch=function(i,o){return of.call(window,typeof i==='string'?fix(i):i,o);};
  }
})();
</script>`;

// Injected into megaplay.buzz pages — routes all megaplay.buzz API calls through our proxy
// so the obfuscated client.js can fetch video sources without hitting CORS.
const MEGAPLAY_INJECT = `<script>
(function(){
  var K='https://megaplay.buzz';
  var P='/api/proxy?url=';
  function fix(u){
    if(!u||typeof u!=='string')return u;
    if(/^(?:data:|blob:)/.test(u))return u;
    if(/^https?:\/\/megaplay\.buzz/i.test(u)||/^\/\/megaplay\.buzz/i.test(u)){
      var abs=u.startsWith('//')?'https:'+u:u;
      return P+encodeURIComponent(abs);
    }
    if(/^https?:\/\//i.test(u)||/^\/\//.test(u))return u;
    var resolved=K+(u.charAt(0)==='/'?'':'/')+u;
    return P+encodeURIComponent(resolved);
  }
  var ox=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    var a=Array.prototype.slice.call(arguments,2);
    return ox.apply(this,[m,fix(String(u||''))].concat(a));
  };
  if(window.fetch){
    var of=window.fetch;
    window.fetch=function(i,o){return of.call(window,typeof i==='string'?fix(i):i,o);};
  }
})();
</script>`;

// Injected into gogoanimes.cv pages to strip the website chrome and show only the video
const GOGO_VIDEO_ONLY = `<style>
html,body{margin:0!important;padding:0!important;background:#000!important;overflow:hidden!important}
/* Hide all page content by default */
body *{visibility:hidden!important;pointer-events:none!important}
/* Bring iframes and video elements back fullscreen */
iframe,video{
  visibility:visible!important;pointer-events:all!important;
  display:block!important;position:fixed!important;
  top:0!important;left:0!important;
  width:100vw!important;height:100vh!important;
  z-index:2147483647!important;border:0!important;
}
/* Keep buttons clickable for the auto-click script */
a,button,[onclick]{pointer-events:all!important}
</style>
<script>
(function(){
  var clicked=false;
  function tryClick(){
    if(clicked)return;
    // Try common server/play button selectors for gogoanimes.cv
    var sel=[
      '.anime_video_body_episodes_item.active a',
      '.anime_video_body_episodes_item:first-child a',
      '.servers-list li:first-child a',
      '.server-item:first-child a',
      'li.active a',
      '.choose-this-server',
      'a[class*="choose"]',
      'a[class*="server"]',
    ];
    for(var i=0;i<sel.length;i++){
      var el=document.querySelector(sel[i]);
      if(el){el.click();clicked=true;return;}
    }
    // Fallback: click any link/button whose text contains "sub" or "choose"
    var els=document.querySelectorAll('a,button');
    for(var i=0;i<els.length;i++){
      var t=(els[i].textContent||'').trim().toLowerCase();
      if(t==='sub'||t.includes('choose this')||t.includes('play sub')){
        els[i].click();clicked=true;return;
      }
    }
  }
  // Try immediately, then retry with delays to handle lazy-rendered buttons
  [100,400,800,1500,3000].forEach(function(d){setTimeout(tryClick,d);});
  document.addEventListener('DOMContentLoaded',function(){[0,300,800].forEach(function(d){setTimeout(tryClick,d);});});
})();
</script>`;

// Injected when proxy is called with &hideChrome=1 — strips all page UI and forces the
// <video> element to fill the entire viewport.
// Problem: JW Player (used by GoGo CDN pages) creates the <video> element dynamically via
// player2.js AND sets inline width/height styles on it and its ancestors. CSS !important
// CAN beat inline styles, but only if the selector specificity is high enough. We also run
// a MutationObserver so we catch the video element the moment JW Player inserts it into the
// DOM and call setProperty(..., 'important') on it directly — the only reliable way to
// override JW Player's own JS-driven inline style mutations.
const CDN_VIDEO_FULLSCREEN = `<style>
html,body{margin:0!important;padding:0!important;background:#000!important;
  width:100%!important;height:100%!important;overflow:hidden!important;}
/* Only the outermost player wrapper fills the viewport — NOT inner control elements */
#player,.jw-wrapper,#main-wrapper,#wrapper,.player-wrap,.play-video,[id*="player"]{
  width:100vw!important;height:100vh!important;max-width:none!important;
  max-height:none!important;margin:0!important;padding:0!important;
  position:fixed!important;top:0!important;left:0!important;
  z-index:2147483640!important;
}
/* Hide site chrome only — all player controls remain untouched */
header,footer,nav,.header,.footer,.nav,.menu,.preheader,.topbar,
.site-header,.site-footer,.site-nav,.top-bar,.navigation,
.anime_info,.anime_info_body,.recent-release,.right-side,.left-side,aside{
  display:none!important;
}
</style>
<script>
(function(){
  function forceFullscreen(el){
    if(!el||el._naForced)return;
    el._naForced=true;
    // Only set cosmetic props — do NOT set position/z-index or we'll cover the controls
    var props={'object-fit':'contain',background:'#000',border:'none'};
    Object.keys(props).forEach(function(k){
      try{el.style.setProperty(k,props[k],'important');}catch(e){}
    });
  }
  function scanVideos(){
    document.querySelectorAll('video').forEach(forceFullscreen);
  }
  var mo=new MutationObserver(function(mutations){
    mutations.forEach(function(m){
      m.addedNodes.forEach(function(n){
        if(n.nodeType!==1)return;
        if(n.tagName==='VIDEO'){forceFullscreen(n);}
        if(n.querySelectorAll){n.querySelectorAll('video').forEach(forceFullscreen);}
      });
    });
    scanVideos();
  });
  function start(){
    try{mo.observe(document.documentElement||document.body,{childList:true,subtree:true});}catch(e){}
    scanVideos();
    [200,500,1000,2000,4000].forEach(function(d){setTimeout(scanVideos,d);});
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',start);}
  else{start();}
})();
</script>`;

// Injected into ALL proxied HTML pages — kills popup ads and click-hijacks before
// anything else runs. window.open is nulled, click/mousedown ad handlers are blocked,
// and any attempt to navigate top/parent is neutralised.
const AD_BLOCKER = `<script>
(function(){
  // Block all new-tab / popup opens
  window.open = function(){ return null; };
  // Block navigating the parent frame
  try{ Object.defineProperty(window,'top',{get:function(){return window;}}); }catch(e){}
  try{ Object.defineProperty(window,'parent',{get:function(){return window;}}); }catch(e){}
  // Intercept clicks — if the target (or any ancestor) is an <a> pointing off-site, kill it
  document.addEventListener('click',function(e){
    var el=e.target;
    while(el&&el!==document){
      if(el.tagName==='A'){
        var href=(el.getAttribute('href')||'').trim();
        // Allow empty, hash, and javascript: void links (UI interactions)
        if(!href||href==='#'||href.startsWith('javascript:'))break;
        // Block anything that looks like an external ad redirect
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      el=el.parentElement;
    }
  },true);
  // Also block mousedown-based openers (common ad trick)
  document.addEventListener('mousedown',function(e){
    if(e.target&&e.target.tagName==='A'){
      var href=(e.target.getAttribute('href')||'').trim();
      if(href&&href!=='#'&&!href.startsWith('javascript:')){
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }
  },true);
})();
</script>`;

// Injected into ALL proxied HTML pages — bridges <video> events/commands via postMessage.
// Uses MutationObserver so it reliably attaches the moment JW Player (or any JS-driven
// player) inserts the <video> element into the DOM, no matter how late that happens.
// Also keeps polling as a fallback for players that replace the element after initial load.
const VIDEO_CONTROL_BRIDGE = `<script>
(function(){
  var _v=null;

  function attach(v){
    if(!v||v===_v)return;
    _v=v;
    function send(){
      try{window.parent.postMessage({
        type:'na_video_state',
        paused:v.paused,
        ended:v.ended,
        time:v.currentTime||0,
        duration:v.duration||0,
        volume:v.volume,
        muted:v.muted,
        buffered:v.buffered.length?v.buffered.end(v.buffered.length-1):0
      },'*');}catch(e){}
    }
    ['play','pause','ended','timeupdate','loadedmetadata','volumechange','seeking'].forEach(function(n){
      v.addEventListener(n,send);
    });
    send();
  }

  // Single message listener — always uses the latest attached video element
  window.addEventListener('message',function(e){
    if(!e.data||!e.data.na_cmd||!_v)return;
    var v=_v,c=e.data;
    switch(c.na_cmd){
      case'play':   try{v.play();}catch(ex){}break;
      case'pause':  v.pause();break;
      case'toggle': if(v.paused){try{v.play();}catch(ex){}}else{v.pause();}break;
      case'seek':   if(isFinite(c.time))v.currentTime=c.time;break;
      case'skip':   if(isFinite(c.delta))v.currentTime=Math.max(0,v.currentTime+c.delta);break;
      case'mute':   v.muted=!v.muted;break;
      case'volume': if(isFinite(c.vol)){v.volume=Math.max(0,Math.min(1,c.vol));v.muted=c.vol===0;}break;
      case'query':
        try{window.parent.postMessage({type:'na_video_state',paused:v.paused,ended:v.ended,
          time:v.currentTime||0,duration:v.duration||0,volume:v.volume,muted:v.muted,
          buffered:v.buffered.length?v.buffered.end(v.buffered.length-1):0},'*');}catch(ex){}
        break;
    }
  });

  function scan(){
    var v=document.querySelector('video');
    if(v&&v!==_v)attach(v);
  }

  // MutationObserver: attach the instant JW Player inserts the <video> element
  var mo=new MutationObserver(function(muts){
    muts.forEach(function(m){
      m.addedNodes.forEach(function(n){
        if(n.nodeType!==1)return;
        if(n.tagName==='VIDEO')attach(n);
        else if(n.querySelectorAll){var v=n.querySelector('video');if(v)attach(v);}
      });
    });
    scan();
  });

  function start(){
    try{mo.observe(document.documentElement||document.body,{childList:true,subtree:true});}catch(e){}
    scan();
    // Fallback polling: covers slow loaders and players that swap the element
    [300,800,1500,3000,5000,8000,12000].forEach(function(d){setTimeout(scan,d);});
  }

  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',start);}
  else{start();}
})();
</script>`;


// Script injected when upstream returns an error page — lets parent know immediately
const ERROR_NOTIFY_SCRIPT = `<script>
(function(){
  try {
    window.parent.postMessage({type:'proxy_error',status:STATUS_CODE},'*');
  } catch(e){}
  // Also fire after a short delay in case parent isn't listening yet
  setTimeout(function(){
    try { window.parent.postMessage({type:'proxy_error',status:STATUS_CODE},'*'); } catch(e){}
  }, 500);
})();
</script>`;

router.get("/proxy", async (req, res) => {
  const rawUrl = req.query.url as string | undefined;
  if (!rawUrl) {
    return res.status(400).json({ error: "url query param required" });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl);
    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
      throw new Error("Only http/https allowed");
    }
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  try {
    const upstream = await fetch(targetUrl.href, {
      headers: {
        ...BROWSER_HEADERS,
        Referer: targetUrl.origin + "/",
        Host: targetUrl.hostname,
      },
      redirect: "follow",
    });

    const contentType = upstream.headers.get("content-type") ?? "text/html; charset=utf-8";
    const isError = upstream.status >= 400;

    for (const [key, value] of upstream.headers.entries()) {
      if (!BLOCKED_RESPONSE_HEADERS.has(key.toLowerCase())) {
        try { res.setHeader(key, value); } catch { /* skip invalid headers */ }
      }
    }

    if (contentType.includes("text/html")) {
      let html = await upstream.text();

      const base = `${targetUrl.origin}/`;

      // Inject <base> before </head> so we never break <head> attributes like profile="..."
      const baseTag = `<base href="${base}">`;
      if (/<\/head>/i.test(html)) {
        html = html.replace(/<\/head>/i, `${baseTag}</head>`);
      } else {
        html = baseTag + html;
      }

      // ── Step 1: neutralise frame-busting JS in the ORIGINAL page scripts ONLY.
      // This must run BEFORE we inject our own scripts so our window.parent calls
      // are never touched by the replacement pass.
      html = html.replace(
        /<script([^>]*?)>([\s\S]*?)<\/script>/gi,
        (match, attrs, body) => {
          const cleaned = body
            .replace(/window\.location\s*=\s*[^;]+;?/g, "")
            .replace(/window\.top\s*[!=]/g, "window.self !=")
            .replace(/window\.parent\s*[!=]/g, "window.self !=")
            .replace(/top\s*!==?\s*self/g, "false")
            .replace(/parent\s*!==?\s*self/g, "false")
            .replace(/top\s*===?\s*self/g, "true")
            .replace(/self\s*!==?\s*top/g, "false");
          return `<script${attrs}>${cleaned}</script>`;
        }
      );

      // ── Step 2: inject our scripts AFTER frame-busting neutralization so they
      // are never corrupted by the window.parent → window.self replacement above.

      // koto=1 — strip anikoto.cz chrome, show only the player, intercept AJAX
      if (req.query.koto === "1") {
        if (/<\/head>/i.test(html)) {
          html = html.replace(/<\/head>/i, `${KOTO_INJECT}</head>`);
        } else {
          html = KOTO_INJECT + html;
        }
      }

      // For gogoanimes.cv — strip website chrome, show video only
      if (targetUrl.hostname.includes("gogoanimes")) {
        if (/<\/head>/i.test(html)) {
          html = html.replace(/<\/head>/i, `${GOGO_VIDEO_ONLY}</head>`);
        } else {
          html = GOGO_VIDEO_ONLY + html;
        }
      }

      // For megaplay.buzz — inject BEFORE client.js runs so the monkey-patch
      // is in place before any API calls are made.
      if (targetUrl.hostname.includes("megaplay")) {
        if (/<head>/i.test(html)) {
          html = html.replace(/<head>/i, `<head>${MEGAPLAY_INJECT}`);
        } else {
          html = MEGAPLAY_INJECT + html;
        }
      }

      // hideChrome=1 — strip CDN player page chrome and make <video> fill the viewport
      if (req.query.hideChrome === "1") {
        if (/<\/head>/i.test(html)) {
          html = html.replace(/<\/head>/i, `${CDN_VIDEO_FULLSCREEN}</head>`);
        } else {
          html = CDN_VIDEO_FULLSCREEN + html;
        }
      }

      // Inject ad-blocker — kills window.open and click hijacks before any player JS runs.
      if (/<\/head>/i.test(html)) {
        html = html.replace(/<\/head>/i, `${AD_BLOCKER}</head>`);
      } else {
        html = AD_BLOCKER + html;
      }

      // Inject control bridge into ALL proxied HTML pages so our play/pause/seek
      // controls can drive whatever <video> element the CDN player renders.
      if (/<\/head>/i.test(html)) {
        html = html.replace(/<\/head>/i, `${VIDEO_CONTROL_BRIDGE}</head>`);
      } else {
        html = VIDEO_CONTROL_BRIDGE + html;
      }

      // If upstream returned an HTTP error, inject a postMessage so the parent can
      // immediately advance to the next fallback server without waiting.
      if (isError) {
        const notifyScript = ERROR_NOTIFY_SCRIPT.replace(/STATUS_CODE/g, String(upstream.status));
        if (/<\/head>/i.test(html)) {
          html = html.replace(/<\/head>/i, `${notifyScript}</head>`);
        } else {
          html = notifyScript + html;
        }
      }

      // Detect soft-error pages: some embed providers return HTTP 200 but render an error
      // message in the page body (e.g. "Missing parameters", "Video not found"). Detect
      // these and fire the same proxy_error postMessage so the parent can auto-retry.
      const SOFT_ERROR_RE = /missing\s+parameters|video\s+not\s+found|not\s+available|invalid\s+(request|id)|no\s+video|embed\s+not\s+found|source\s+not\s+found/i;
      if (!isError && SOFT_ERROR_RE.test(html.slice(0, 8000))) {
        const notifyScript = ERROR_NOTIFY_SCRIPT.replace(/STATUS_CODE/g, "404");
        if (/<\/head>/i.test(html)) {
          html = html.replace(/<\/head>/i, `${notifyScript}</head>`);
        } else {
          html = notifyScript + html;
        }
      }

      res.setHeader("Content-Type", contentType);
      return res.send(html);
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    return res.send(buffer);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const errHtml = ERROR_NOTIFY_SCRIPT.replace(/STATUS_CODE/g, "502") +
      `<html><body style="background:#111;color:#888;font-family:monospace;padding:2rem">
        <p>Proxy error (502): ${msg.replace(/</g, "&lt;")}</p>
      </body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(errHtml);
  }
});

export default router;

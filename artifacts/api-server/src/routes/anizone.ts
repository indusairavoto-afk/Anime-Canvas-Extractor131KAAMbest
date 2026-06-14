import { Router } from "express";

const router = Router();

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "identity",
  "Cache-Control": "no-cache",
};

/**
 * Encode a CDN URL to a safe proxy path segment.
 */
function encodeProxyUrl(url: string): string {
  return Buffer.from(url).toString("base64url");
}

/**
 * Build a proxy URL for an HLS resource. Keeps query-string clean.
 */
function proxyUrl(cdnUrl: string): string {
  return `/api/anizone/hls?u=${encodeProxyUrl(cdnUrl)}`;
}

/**
 * Rewrite a raw m3u8 playlist so every URI (absolute or relative) goes
 * through our proxy endpoint.  Handles both master playlists (which list
 * rendition playlists) and media playlists (which list .ts segments).
 * Also rewrites URI= attributes inside #EXT-X-KEY and #EXT-X-MAP tags.
 */
function rewriteM3u8(body: string, baseUrl: string): string {
  const base = new URL(baseUrl);

  function toProxy(uri: string): string {
    const absolute = /^https?:\/\//i.test(uri)
      ? uri
      : new URL(uri, base).toString();
    return proxyUrl(absolute);
  }

  return body
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return line;

      if (t.startsWith("#")) {
        // Rewrite URI="..." attributes inside tag lines (e.g. #EXT-X-KEY, #EXT-X-MAP)
        return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${toProxy(uri)}"`);
      }

      return toProxy(t);
    })
    .join("\n");
}

/**
 * Decode \uXXXX escapes embedded inside Alpine.js JSON.parse('...') strings.
 */
function decodeAlpineJson(raw: string): Record<string, string> {
  const decoded = raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16)),
  );
  return JSON.parse(decoded);
}

/**
 * Pick the best English title from an AniDB-style language-keyed title map.
 * Key "1" = English, "5" = Japanese romanisation, "8" = Japanese native.
 */
function pickTitle(titles: Record<string, string>, fallback: string): string {
  return (
    titles["1"] ||
    titles["10"] ||
    titles["5"] ||
    Object.values(titles)[0] ||
    fallback
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/anizone/hls?u=<base64url-encoded-cdn-url>
//
// Proxies HLS resources (master/media .m3u8 playlists and .ts segments)
// through the server so the browser never makes cross-origin CDN requests.
// .m3u8 responses have their internal URIs rewritten to go through this proxy.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/anizone/hls", async (req, res) => {
  const encoded = (req.query.u as string | undefined)?.trim();
  if (!encoded) return res.status(400).send("u param required");

  let cdnUrl: string;
  try {
    cdnUrl = Buffer.from(encoded, "base64url").toString("utf8");
    new URL(cdnUrl);
  } catch {
    return res.status(400).send("invalid u param");
  }

  try {
    const upstream = await fetch(cdnUrl, {
      headers: {
        "User-Agent": BROWSER_HEADERS["User-Agent"],
        "Accept-Encoding": "identity",
        Referer: "https://anizone.to/",
        Origin: "https://anizone.to",
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send(`CDN returned ${upstream.status}`);
    }

    const contentType = upstream.headers.get("content-type") ?? "";

    if (
      cdnUrl.includes(".m3u8") ||
      contentType.includes("mpegurl") ||
      contentType.includes("x-mpegURL")
    ) {
      const text = await upstream.text();
      const rewritten = rewriteM3u8(text, cdnUrl);

      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-cache");
      return res.send(rewritten);
    }

    res.setHeader(
      "Content-Type",
      contentType || "video/mp2t",
    );
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-cache");

    const buf = await upstream.arrayBuffer();
    return res.send(Buffer.from(buf));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "proxy error";
    return res.status(502).send(msg);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/anizone/search?q=...&limit=10
// ─────────────────────────────────────────────────────────────────────────────
router.get("/anizone/search", async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  const limit = Math.min(parseInt((req.query.limit as string) || "10"), 20);
  if (!q) return res.status(400).json({ error: "q query param required" });

  const searchUrl = `https://anizone.to/anime?search=${encodeURIComponent(q)}`;

  try {
    const upstream = await fetch(searchUrl, {
      headers: {
        ...BROWSER_HEADERS,
        Referer: "https://anizone.to/",
        Host: "anizone.to",
      },
    });

    if (!upstream.ok) {
      return res.json({ results: [], query: q, total: 0 });
    }

    const html = await upstream.text();

    const results: { slug: string; title: string; thumbnail: string }[] = [];
    const seenSlugs = new Set<string>();

    // The search page renders each result item with Alpine.js.
    // Pattern: window.getTitle(this.anmTitles, 'Default Title') comes first,
    // then the slug href appears ~850-950 chars later, then the thumbnail.
    const getTitleRe = /window\.getTitle\(this\.anmTitles,\s*'([^']+)'\)/g;
    let tm: RegExpExecArray | null;
    while ((tm = getTitleRe.exec(html)) !== null && results.length < limit) {
      const title = tm[1];
      const afterTitle = html.slice(
        tm.index + tm[0].length,
        tm.index + tm[0].length + 2000,
      );

      const slugMatch = afterTitle.match(
        /href="https:\/\/anizone\.to\/anime\/([a-z0-9]+)"/,
      );
      if (!slugMatch) continue;
      const slug = slugMatch[1];
      if (seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);

      const thumbMatch = afterTitle.match(
        /src="(https:\/\/anizone\.to\/images\/anime\/[^"]+)"/,
      );
      results.push({ slug, title, thumbnail: thumbMatch?.[1] ?? "" });
    }

    return res.json({ results, query: q, total: results.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.status(502).json({ error: msg, results: [] });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/anizone/player?slug=...&ep=...
// ─────────────────────────────────────────────────────────────────────────────
router.get("/anizone/player", async (req, res) => {
  const slug = (req.query.slug as string | undefined)?.trim();
  const ep = (req.query.ep as string | undefined)?.trim();
  if (!slug || !ep)
    return res.status(400).send("slug and ep query params required");

  const pageUrl = `https://anizone.to/anime/${encodeURIComponent(slug)}/${encodeURIComponent(ep)}`;

  try {
    const upstream = await fetch(pageUrl, {
      headers: {
        ...BROWSER_HEADERS,
        Referer: "https://anizone.to/",
        Host: "anizone.to",
      },
    });

    if (!upstream.ok) {
      return res
        .status(upstream.status)
        .send(`anizone.to returned ${upstream.status} for ${pageUrl}`);
    }

    const html = await upstream.text();

    const hlsMatch = html.match(
      /<media-player[^>]+\bsrc="([^"]+\.m3u8[^"]*)"/i,
    );
    if (!hlsMatch) {
      return res
        .status(404)
        .send("No HLS stream found for this episode on anizone.to");
    }
    const hlsUrl = hlsMatch[1];

    // Route the HLS master playlist through our proxy so the browser never
    // makes direct cross-origin requests to the CDN.
    const proxiedHlsUrl = proxyUrl(hlsUrl);

    interface SubTrack {
      src: string;
      label: string;
      srclang: string;
      isDefault: boolean;
    }
    const subtitles: SubTrack[] = [];
    const trackRe =
      /<track\s+src=(https:\/\/[^\s>]+\.ass)[^>]*?label="([^"]+)"[^>]*?srclang="([^"]+)"([^>]*?)\/?>/gi;
    let trm: RegExpExecArray | null;
    while ((trm = trackRe.exec(html)) !== null) {
      subtitles.push({
        src: trm[1],
        label: trm[2],
        srclang: trm[3],
        isDefault: trm[4].includes("default"),
      });
    }

    const enSub = subtitles.find((s) => s.srclang === "en");
    const subsJson = JSON.stringify(subtitles);

    const playerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AniZone Player</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#000;overflow:hidden}
#v{width:100%;height:100%;display:block;outline:none}
#err{display:none;position:absolute;inset:0;color:#ccc;font:14px/1.4 sans-serif;
     background:#111;align-items:center;justify-content:center;text-align:center;padding:16px}
#err.show{display:flex}
</style>
</head>
<body>
<video id="v" controls autoplay playsinline crossorigin="anonymous">
${enSub ? `<track src="${enSub.src}" kind="subtitles" label="${enSub.label}" srclang="${enSub.srclang}" default>` : ""}
</video>
<div id="err"></div>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.6.5/dist/hls.min.js" crossorigin="anonymous"></script>
<script>
(function(){
  var src = ${JSON.stringify(proxiedHlsUrl)};
  var subs = ${subsJson};
  var v = document.getElementById('v');
  var errEl = document.getElementById('err');

  function showErr(msg) {
    errEl.textContent = msg;
    errEl.classList.add('show');
  }

  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    var hls = new Hls({ enableWorker: false, startLevel: -1 });
    hls.loadSource(src);
    hls.attachMedia(v);
    hls.on(Hls.Events.MANIFEST_PARSED, function() {
      v.play().catch(function(){});
    });
    hls.on(Hls.Events.ERROR, function(_, data) {
      if (data.fatal) showErr('Stream error: ' + (data.details || 'unknown'));
    });
  } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
    v.src = src;
    v.addEventListener('loadedmetadata', function() { v.play().catch(function(){}); });
    v.addEventListener('error', function() { showErr('Failed to load stream.'); });
  } else {
    showErr('Your browser does not support HLS playback.');
  }
})();
</script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    return res.send(playerHtml);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.status(502).send(msg);
  }
});

export default router;

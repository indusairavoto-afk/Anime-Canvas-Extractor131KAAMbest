import { Router } from "express";

const router = Router();

const API_BASE = "https://api.miruro.tv";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "identity",
  "Cache-Control": "no-cache",
  Origin: "https://miruro.to",
  Referer: "https://miruro.to/",
};

function encodeProxyUrl(url: string): string {
  return Buffer.from(url).toString("base64url");
}

function proxyHlsUrl(hlsUrl: string): string {
  return `/api/miruro/hls?u=${encodeProxyUrl(hlsUrl)}`;
}

function rewriteM3u8(body: string, baseUrl: string): string {
  const base = new URL(baseUrl);

  function toProxy(uri: string): string {
    const absolute = /^https?:\/\//i.test(uri) ? uri : new URL(uri, base).toString();
    return proxyHlsUrl(absolute);
  }

  return body
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${toProxy(uri)}"`);
      }
      return toProxy(t);
    })
    .join("\n");
}

interface MiruroEpisode {
  id: string;
  title?: string | null;
  number?: number | null;
  image?: string | null;
}

interface MiruroSource {
  url: string;
  isM3U8?: boolean;
  quality?: string;
}

interface MiruroSubtitle {
  url: string;
  lang: string;
}

interface MiruroWatchResponse {
  sources?: MiruroSource[];
  subtitles?: MiruroSubtitle[];
}

async function fetchEpisodes(anilistId: string): Promise<MiruroEpisode[]> {
  const url = `${API_BASE}/meta/anilist/episodes/${anilistId}?fetchFiller=true`;
  const resp = await fetch(url, { headers: BROWSER_HEADERS });
  if (!resp.ok) throw new Error(`miruro episodes API returned ${resp.status}`);
  const data = await resp.json() as MiruroEpisode[] | { results?: MiruroEpisode[] };
  if (Array.isArray(data)) return data;
  if (Array.isArray((data as { results?: MiruroEpisode[] }).results)) return (data as { results: MiruroEpisode[] }).results;
  return [];
}

async function fetchStream(episodeId: string): Promise<MiruroWatchResponse> {
  const url = `${API_BASE}/meta/anilist/watch/${encodeURIComponent(episodeId)}`;
  const resp = await fetch(url, { headers: BROWSER_HEADERS });
  if (!resp.ok) throw new Error(`miruro watch API returned ${resp.status}`);
  return await resp.json() as MiruroWatchResponse;
}

function pickBestSource(sources: MiruroSource[]): MiruroSource | null {
  if (!sources.length) return null;
  const m3u8Sources = sources.filter((s) => s.isM3U8 !== false);
  const preferred = ["1080p", "720p", "480p", "360p", "default", "backup"];
  for (const q of preferred) {
    const found = m3u8Sources.find((s) => s.quality?.toLowerCase() === q);
    if (found) return found;
  }
  return m3u8Sources[0] ?? sources[0];
}

/**
 * GET /api/miruro/hls?u=<base64url-encoded-cdn-url>
 * Proxies HLS streams through the server with miruro.to referer headers.
 */
router.get("/miruro/hls", async (req, res) => {
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
        Referer: "https://miruro.to/",
        Origin: "https://miruro.to",
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send(`CDN returned ${upstream.status}`);
    }

    const contentType = upstream.headers.get("content-type") ?? "";

    if (cdnUrl.includes(".m3u8") || contentType.includes("mpegurl") || contentType.includes("x-mpegURL")) {
      const text = await upstream.text();
      const rewritten = rewriteM3u8(text, cdnUrl);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-cache");
      return res.send(rewritten);
    }

    res.setHeader("Content-Type", contentType || "video/mp2t");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-cache");
    const buf = await upstream.arrayBuffer();
    return res.send(Buffer.from(buf));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "proxy error";
    return res.status(502).send(msg);
  }
});

/**
 * GET /api/miruro/stream?anilistId=...&ep=...
 * Fetches a proxied HLS stream URL and subtitles for the given episode.
 * Returns: { hlsUrl, subtitles, episodeId }
 */
router.get("/miruro/stream", async (req, res) => {
  const anilistId = (req.query.anilistId as string | undefined)?.trim();
  const ep = (req.query.ep as string | undefined)?.trim();

  if (!anilistId || !ep) {
    return res.status(400).json({ error: "anilistId and ep query params are required" });
  }

  const epNum = parseInt(ep);
  if (isNaN(epNum) || epNum <= 0) {
    return res.status(400).json({ error: `Invalid ep value: "${ep}"` });
  }

  try {
    const episodes = await fetchEpisodes(anilistId);
    if (!episodes.length) {
      return res.status(404).json({ error: "No episodes found for this anime on Miruro" });
    }

    const episode = episodes.find((e) => e.number === epNum) ?? episodes[epNum - 1] ?? null;
    if (!episode?.id) {
      return res.status(404).json({ error: `Episode ${epNum} not found on Miruro (total: ${episodes.length})` });
    }

    const watchData = await fetchStream(episode.id);
    const sources = watchData.sources ?? [];
    const best = pickBestSource(sources);

    if (!best?.url) {
      return res.status(404).json({ error: "No stream source found for this episode on Miruro" });
    }

    const hlsUrl = proxyHlsUrl(best.url);

    const subtitles = (watchData.subtitles ?? [])
      .filter((s) => s.url && s.lang)
      .map((s) => ({
        src: s.url,
        label: s.lang,
        srclang: s.lang.toLowerCase().slice(0, 2),
        isDefault: s.lang.toLowerCase().includes("english"),
      }));

    res.setHeader("Cache-Control", "no-cache");
    return res.json({
      hlsUrl,
      subtitles,
      episodeId: episode.id,
      quality: best.quality ?? "default",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    req.log.warn({ err, anilistId, ep }, "miruro/stream failed");
    return res.status(502).json({ error: msg });
  }
});

export default router;

import { Router } from "express";

const router = Router();

function encodeProxyUrl(url: string): string {
  return Buffer.from(url).toString("base64url");
}

function proxyHlsUrl(hlsUrl: string): string {
  return `/api/anizone/hls?u=${encodeProxyUrl(hlsUrl)}`;
}

function extractHlsFromPlayerUrl(playerUrl: string): string | null {
  const hashIdx = playerUrl.indexOf("#");
  if (hashIdx === -1) return null;
  const fragment = playerUrl.slice(hashIdx + 1).replace(/#$/, "");
  if (!fragment) return null;
  try {
    const decoded = Buffer.from(fragment, "base64").toString("utf-8");
    if (decoded.startsWith("http://") || decoded.startsWith("https://")) return decoded;
  } catch {
    // not valid base64
  }
  return null;
}

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "identity",
  "Cache-Control": "no-cache",
};

const AJAX_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "identity",
  "Cache-Control": "no-cache",
  "X-Requested-With": "XMLHttpRequest",
  Origin: "https://anikoto.cz",
  Referer: "https://anikoto.cz/",
};

interface StreamResult {
  url: string;
  skipData: unknown;
  isDub?: boolean;
  sourceTitle?: string | null;
}

async function decryptLinkId(token: string): Promise<StreamResult | null> {
  const resp = await fetch(
    `https://anikoto.cz/ajax/server?get=${encodeURIComponent(token)}`,
    {
      headers: {
        ...AJAX_HEADERS,
        Referer: "https://anikoto.cz/watch/",
      },
    }
  );
  if (!resp.ok) return null;
  const data = (await resp.json()) as {
    status: number;
    result?: { url?: string; skip_data?: unknown };
  };
  if (data.status !== 200 || !data.result?.url) return null;
  return { url: data.result.url, skipData: data.result.skip_data ?? null };
}

async function tryLinkIds(linkIds: string[]): Promise<StreamResult | null> {
  for (const id of linkIds) {
    try {
      const r = await decryptLinkId(id);
      if (r?.url) return r;
    } catch {
      // try next
    }
  }
  return null;
}

function extractLinkIds(html: string): string[] {
  const ids: string[] = [];
  const seenIds = new Set<string>();

  for (const type of ["sub", "hsub", "dub"]) {
    const typeRe = new RegExp(
      `data-type="${type}"[\\s\\S]*?(?=data-type="|$)`,
      "i"
    );
    const typeBlock = html.match(typeRe)?.[0] ?? "";
    const linkRe = /data-link-id="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(typeBlock)) !== null) {
      const id = m[1].trim();
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        ids.push(id);
      }
    }
  }

  const allRe = /data-link-id="([^"]+)"/g;
  let m2: RegExpExecArray | null;
  while ((m2 = allRe.exec(html)) !== null) {
    const id = m2[1].trim();
    if (id && !seenIds.has(id)) {
      seenIds.add(id);
      ids.push(id);
    }
  }

  return ids;
}

async function fetchViaAnikotoNative(slug: string, ep: number): Promise<StreamResult | null> {
  const pageResp = await fetch(
    `https://anikoto.cz/watch/${encodeURIComponent(slug)}/ep-${ep}`,
    {
      headers: {
        ...BROWSER_HEADERS,
        Referer: "https://anikoto.cz/",
        Host: "anikoto.cz",
      },
    }
  );
  if (!pageResp.ok) return null;
  const pageHtml = await pageResp.text();

  // Extract page title for episode verification
  const pageTitleMatch = pageHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
  const sourceTitle = pageTitleMatch?.[1]?.trim().replace(/\s+/g, " ") ?? null;

  const animeIdMatch = pageHtml.match(/data-id="(\d+)"/);
  if (!animeIdMatch) return null;
  const animeId = animeIdMatch[1];

  const epListResp = await fetch(
    `https://anikoto.cz/ajax/episode/list/${animeId}`,
    {
      headers: {
        ...AJAX_HEADERS,
        Referer: `https://anikoto.cz/watch/${encodeURIComponent(slug)}/ep-${ep}`,
      },
    }
  );
  if (!epListResp.ok) return null;
  const epListJson = (await epListResp.json()) as {
    status: number;
    result?: string;
  };
  const epHtml = epListJson.result ?? "";

  const tagRe = new RegExp(`<a[^>]+data-num="${ep}"[^>]*>`, "i");
  const tagMatch = epHtml.match(tagRe);
  if (!tagMatch) return null;
  const tagStr = tagMatch[0];
  const dataIdsMatch = tagStr.match(/data-ids="([^"]+)"/);
  if (!dataIdsMatch) return null;
  const dataIds = dataIdsMatch[1];

  const serverListResp = await fetch(
    `https://anikoto.cz/ajax/server/list?servers=${encodeURIComponent(dataIds)}`,
    {
      headers: {
        ...AJAX_HEADERS,
        Referer: `https://anikoto.cz/watch/${encodeURIComponent(slug)}/ep-${ep}`,
      },
    }
  );
  if (!serverListResp.ok) return null;
  const serverListJson = (await serverListResp.json()) as {
    status: number;
    result?: string;
  };
  if (serverListJson.status !== 200) return null;
  const serverHtml = serverListJson.result ?? "";

  const linkIds = extractLinkIds(serverHtml);
  if (linkIds.length === 0) return null;

  const streamResult = await tryLinkIds(linkIds);
  if (!streamResult) return null;
  return { ...streamResult, sourceTitle };
}

async function fetchViaMapper(malId: string, ep: string, preferDub = false): Promise<StreamResult | null> {
  const timestamp = Math.floor(Date.now() / 1000);
  const mapperUrl = `https://mapper.nekostream.site/api/mal/${malId}/${ep}/${timestamp}`;
  const mapperResp = await fetch(mapperUrl, {
    headers: {
      ...AJAX_HEADERS,
      Referer: "https://anikoto.cz/",
      Host: "mapper.nekostream.site",
    },
  });
  if (!mapperResp.ok) return null;

  const mapperData = (await mapperResp.json()) as Record<string, unknown>;

  let encryptedUrl: string | null = null;
  let isDub = false;

  if (preferDub) {
    // When dub is preferred: try dub first, fall back to sub
    for (const [source, data] of Object.entries(mapperData)) {
      if (source === "status") continue;
      const d = data as Record<string, { url?: string }> | null;
      if (d?.dub?.url) { encryptedUrl = d.dub.url; isDub = true; break; }
    }
    if (!encryptedUrl) {
      for (const [source, data] of Object.entries(mapperData)) {
        if (source === "status") continue;
        const d = data as Record<string, { url?: string }> | null;
        if (d?.sub?.url) { encryptedUrl = d.sub.url; isDub = false; break; }
      }
    }
  } else {
    // Default: sub first, dub fallback
    for (const [source, data] of Object.entries(mapperData)) {
      if (source === "status") continue;
      const d = data as Record<string, { url?: string }> | null;
      if (d?.sub?.url) { encryptedUrl = d.sub.url; isDub = false; break; }
      if (!encryptedUrl && d?.dub?.url) { encryptedUrl = d.dub.url; isDub = true; }
    }
  }

  if (!encryptedUrl) return null;

  const result = await decryptLinkId(encryptedUrl);
  if (!result?.url) return null;
  return { ...result, isDub };
}

/**
 * GET /api/koto/stream?slug={kotoSlug}&malId={malId}&ep={episodeNumber}
 */
router.get("/koto/stream", async (req, res) => {
  const slug = (req.query.slug as string | undefined)?.trim();
  const ep = (req.query.ep as string | undefined)?.trim();
  const malId = (req.query.malId as string | undefined)?.trim();
  const preferDub = (req.query.preferDub as string | undefined) === "1";

  req.log.info({ slug, ep, malId, preferDub }, "koto/stream params");

  if (!ep) {
    return res.status(400).json({ error: "ep query param required" });
  }
  if (!slug && !malId) {
    return res.status(400).json({ error: "slug or malId query param required" });
  }

  function buildResponse(result: StreamResult) {
    const rawHls = extractHlsFromPlayerUrl(result.url);
    return {
      url: result.url,
      hlsUrl: rawHls ? proxyHlsUrl(rawHls) : null,
      skipData: result.skipData,
      isDub: result.isDub ?? false,
      sourceTitle: result.sourceTitle ?? null,
    };
  }

  let nativeFallbackResult: StreamResult | null = null;

  if (slug) {
    try {
      const result = await fetchViaAnikotoNative(slug, parseInt(ep));
      if (result?.url) {
        const rawHls = extractHlsFromPlayerUrl(result.url);
        if (rawHls) {
          return res.json(buildResponse(result));
        }
        nativeFallbackResult = result;
        req.log.info({ url: result.url }, "native anikoto returned non-HLS URL, trying mapper for HLS");
      }
    } catch (err: unknown) {
      req.log.warn({ err }, "native anikoto pipeline failed, trying mapper fallback");
    }
  }

  if (malId) {
    try {
      const result = await fetchViaMapper(malId, ep, preferDub);
      if (result?.url) {
        return res.json(buildResponse(result));
      }
    } catch (err: unknown) {
      req.log.warn({ err }, "mapper fallback also failed");
    }
  }

  if (nativeFallbackResult) {
    req.log.info("mapper yielded no stream, using native non-HLS URL as last resort");
    return res.json(buildResponse(nativeFallbackResult));
  }

  return res.status(404).json({ error: "No stream URL found for this episode" });
});

/**
 * GET /api/koto/search?q=...&limit=10
 * Searches anikoto.cz for anime matching the query.
 * Uses multiple regex fallback patterns for robustness.
 */
router.get("/koto/search", async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  const limit = Math.min(parseInt((req.query.limit as string) || "10"), 20);
  if (!q) return res.status(400).json({ error: "q query param required" });

  try {
    const upstream = await fetch(
      `https://anikoto.cz/ajax/anime/search?keyword=${encodeURIComponent(q)}`,
      {
        headers: {
          ...AJAX_HEADERS,
          Referer: "https://anikoto.cz/",
          Host: "anikoto.cz",
        },
      }
    );
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `anikoto.cz returned ${upstream.status}`, results: [] });
    }

    const data = await upstream.json() as {
      status: number;
      result?: { html?: string } | string;
    };

    let html = "";
    if (typeof data.result === "object" && data.result !== null) {
      html = (data.result as { html?: string }).html ?? "";
    } else if (typeof data.result === "string") {
      html = data.result;
    }

    if (!html) {
      return res.json({ results: [], query: q, total: 0 });
    }

    const results: { slug: string; title: string; thumbnail: string }[] = [];
    const seen = new Set<string>();

    // Pattern 1: full block with slug + image + title class
    const blockRe = /href="https?:\/\/anikoto\.cz\/watch\/([^"\/\s]+)"[\s\S]*?<img[^>]+src="([^"]*)"[\s\S]*?class="[^"]*d-title[^"]*"[^>]*>([^<]+)</g;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(html)) !== null && results.length < limit) {
      const slug = m[1].trim();
      const thumbnail = m[2].trim();
      const title = m[3].trim();
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      results.push({ slug, title, thumbnail });
    }

    // Pattern 2: slug + title inside same anchor (no image required)
    if (results.length === 0) {
      const anchorRe = /<a[^>]+href="https?:\/\/anikoto\.cz\/watch\/([^"\/\s]+)"[^>]*>\s*(?:<[^>]+>\s*)*([^<]{2,80})/gi;
      while ((m = anchorRe.exec(html)) !== null && results.length < limit) {
        const slug = m[1].trim();
        const rawText = m[2].trim();
        if (!slug || seen.has(slug) || !rawText) continue;
        const title = rawText.replace(/&amp;/g, "&").replace(/&[a-z]+;/gi, "").trim();
        if (!title || title.length < 2) continue;
        seen.add(slug);
        results.push({ slug, title, thumbnail: "" });
      }
    }

    // Pattern 3: just extract slugs as last resort
    if (results.length === 0) {
      const slugRe = /href="https?:\/\/anikoto\.cz\/watch\/([^"\/\s]+)"/g;
      while ((m = slugRe.exec(html)) !== null && results.length < limit) {
        const slug = m[1].trim();
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        results.push({ slug, title: slug.replace(/-/g, " "), thumbnail: "" });
      }
    }

    // For any result missing a title, try to extract it from a nearby title attribute
    const enriched = results.map((r) => {
      if (r.title && r.title !== r.slug.replace(/-/g, " ")) return r;
      const titleAttrRe = new RegExp(`href="https?://anikoto\\.cz/watch/${r.slug}"[^>]*title="([^"]+)"`, "i");
      const tm = html.match(titleAttrRe);
      return { ...r, title: tm?.[1]?.trim() ?? r.title };
    });

    return res.json({ results: enriched, query: q, total: enriched.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.status(502).json({ error: msg, results: [] });
  }
});

export default router;

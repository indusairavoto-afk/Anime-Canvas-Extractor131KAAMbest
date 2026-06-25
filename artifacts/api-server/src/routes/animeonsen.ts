import { Router } from "express";

const router = Router();

const ANIMEONSEN_ORIGIN = "https://www.animeonsen.xyz";
const SEARCH_API = "https://search.animeonsen.xyz";
const SEARCH_TOKEN = "0e36d0275d16b40d7cf153634df78bc229320d073f565db2aaf6d027e0c30b13";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

interface SearchHit {
  content_id: string;
  content_title: string;
  content_title_en: string;
  content_title_jp: string;
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function scoreHit(hit: SearchHit, query: string): number {
  const qNorm = normalizeTitle(query);
  const titles = [
    normalizeTitle(hit.content_title ?? ""),
    normalizeTitle(hit.content_title_en ?? ""),
    normalizeTitle(hit.content_title_jp ?? ""),
  ];
  let best = 0;
  for (const t of titles) {
    if (!t) continue;
    let score = 0;
    if (t === qNorm) { score = 1000; }
    else if (t.startsWith(qNorm)) { score = 800; }
    else if (qNorm.startsWith(t)) { score = 700; }
    else if (t.includes(qNorm)) { score = 500; }
    else if (qNorm.includes(t)) { score = 400; }
    else {
      const qWords = new Set(qNorm.split(" ").filter(Boolean));
      const tWords = t.split(" ").filter(Boolean);
      const overlap = tWords.filter(w => qWords.has(w)).length;
      score = overlap * 60;
    }
    if (score > best) best = score;
  }
  return best;
}

function buildQueryVariants(rawTitle: string): string[] {
  const variants: string[] = [rawTitle];

  const noSeason = rawTitle.replace(/\s*(season|part)\s*\d+/gi, "").trim();
  if (noSeason && noSeason !== rawTitle) variants.push(noSeason);
  const noOrdinal = rawTitle.replace(/\s*\d+(st|nd|rd|th)\s*season/gi, "").trim();
  if (noOrdinal && noOrdinal !== rawTitle) variants.push(noOrdinal);

  const words = rawTitle.trim().split(/\s+/);
  if (words.length > 5) variants.push(words.slice(0, 5).join(" "));
  if (words.length > 3) variants.push(words.slice(0, 3).join(" "));

  const stops = new Set(["of", "the", "a", "an", "in", "on", "at", "to", "and"]);
  const noStops = words.filter(w => !stops.has(w.toLowerCase())).join(" ");
  if (noStops && noStops !== rawTitle) variants.push(noStops);

  return variants.filter((q, i, arr) => q && arr.indexOf(q) === i);
}

async function searchContentId(titles: string[]): Promise<{ contentId: string; matchedTitle: string } | null> {
  for (const rawTitle of titles) {
    if (!rawTitle) continue;
    const queries = buildQueryVariants(rawTitle);

    for (const query of queries) {
      if (!query) continue;
      try {
        const resp = await fetch(`${SEARCH_API}/indexes/content/search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SEARCH_TOKEN}`,
            Origin: ANIMEONSEN_ORIGIN,
            Referer: `${ANIMEONSEN_ORIGIN}/`,
            ...BROWSER_HEADERS,
          },
          body: JSON.stringify({ q: query, limit: 8 }),
          signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) continue;
        const data = (await resp.json()) as { hits: SearchHit[] };
        if (!data.hits?.length) continue;

        let best: { hit: SearchHit; score: number } | null = null;
        for (const hit of data.hits) {
          const score = scoreHit(hit, rawTitle);
          if (!best || score > best.score) best = { hit, score };
        }
        if (best && best.score >= 120) {
          return { contentId: best.hit.content_id, matchedTitle: best.hit.content_title_en || best.hit.content_title };
        }
      } catch {
        // continue to next query variant
      }
    }
  }
  return null;
}

/**
 * Shared helper: fetch the AnimeonSen watch page (server-accessible), extract the
 * ao.session cookie, and derive the Bearer token via watch.js's obfuscation scheme:
 *   bearer = base64_decode(ao.session).chars.map(c => charCode(c) + 1).join("")
 *
 * The derived token is a valid JWT that the browser also uses — but we return it so
 * the *browser* (not the server) can call api.animeonsen.xyz, bypassing the IP block.
 */
async function fetchBearerToken(contentId: string): Promise<{ bearerToken: string; aoSession: string } | null> {
  try {
    const watchUrl = `${ANIMEONSEN_ORIGIN}/watch/${contentId}?episode=1`;
    const pageResp = await fetch(watchUrl, {
      headers: {
        ...BROWSER_HEADERS,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    if (!pageResp.ok) return null;

    // Extract ao.session — try three methods in order of reliability
    let aoSession: string | null = null;

    const extractFromCookieStr = (s: string): string | null => {
      const m = s.match(/ao\.session=([^;,\s]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    };

    // 1. Node 18+ Headers.getSetCookie() — one header per entry, no splitting ambiguity
    const getSetCookieFn = (pageResp.headers as unknown as { getSetCookie?(): string[] }).getSetCookie;
    if (typeof getSetCookieFn === "function") {
      for (const h of getSetCookieFn.call(pageResp.headers)) {
        const v = extractFromCookieStr(h);
        if (v) { aoSession = v; break; }
      }
    }

    // 2. headers.get('set-cookie') — may be comma-joined across entries
    if (!aoSession) {
      const raw = pageResp.headers.get("set-cookie") ?? "";
      if (raw) {
        for (const part of raw.split(/,(?=[^;]*=)/)) {
          const v = extractFromCookieStr(part);
          if (v) { aoSession = v; break; }
        }
      }
    }

    // 3. HTML inline fallback — some builds embed the session in a script tag
    if (!aoSession) {
      const html = await pageResp.text();
      const inline = html.match(/ao\.session['"]\s*[,=:]\s*['"]([A-Za-z0-9+/=]+)['"]/);
      if (inline) aoSession = inline[1];
    }

    if (!aoSession) return null;

    // Derive Bearer token: base64_decode(ao.session) → shift each char code +1
    // (reverses the -1 obfuscation used in watch.js to store the JWT in the cookie)
    const shifted = Buffer.from(aoSession, "base64").toString("binary");
    const bearerToken = Array.from(shifted)
      .map(c => String.fromCharCode(c.charCodeAt(0) + 1))
      .join("");

    return { bearerToken, aoSession };
  } catch {
    return null;
  }
}

/**
 * GET /api/animeonsen/token?contentId=...
 *
 * Returns the Bearer token derived from the ao.session cookie so the browser
 * can call api.animeonsen.xyz directly (from the user's unblocked IP).
 * This is the working bypass: server handles token derivation, browser makes
 * the actual video API call where it won't be IP-blocked.
 */
router.get("/animeonsen/token", async (req, res) => {
  const contentId = (req.query.contentId as string | undefined)?.trim();
  if (!contentId) {
    res.status(400).json({ error: "contentId is required" });
    return;
  }
  const result = await fetchBearerToken(contentId);
  if (!result) {
    res.status(502).json({ error: "Could not obtain ao.session from AnimeonSen" });
    return;
  }
  res.json({ bearerToken: result.bearerToken });
});

/**
 * GET /api/animeonsen/video?contentId=...&ep=...
 *
 * Attempts full server-side HLS extraction using the ao.session Bearer token.
 * api.animeonsen.xyz is IP-blocked from Replit servers so this returns 502 in practice;
 * the /token endpoint + browser-side call is the working path. Kept for completeness.
 */
router.get("/animeonsen/video", async (req, res) => {
  const contentId = (req.query.contentId as string | undefined)?.trim();
  const ep = (req.query.ep as string | undefined)?.trim() ?? "1";

  if (!contentId) {
    res.status(400).json({ error: "contentId is required" });
    return;
  }
  const epNum = parseInt(ep);
  if (isNaN(epNum) || epNum <= 0) {
    res.status(400).json({ error: `Invalid ep: "${ep}"` });
    return;
  }

  try {
    const tokenResult = await fetchBearerToken(contentId);
    if (!tokenResult) {
      res.status(502).json({ error: "Could not obtain ao.session from AnimeonSen watch page" });
      return;
    }
    const { bearerToken, aoSession } = tokenResult;

    const apiEndpoint = `https://api.animeonsen.xyz/v4/content/${contentId}/video/${epNum}`;
    const apiResp = await fetch(apiEndpoint, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Cookie: `ao.session=${aoSession}`,
        Origin: ANIMEONSEN_ORIGIN,
        Referer: `${ANIMEONSEN_ORIGIN}/`,
        Accept: "application/json, */*;q=0.8",
        ...BROWSER_HEADERS,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!apiResp.ok) {
      const body = await apiResp.text().catch(() => "");
      res.status(502).json({
        error: `AnimeonSen API returned ${apiResp.status}`,
        detail: body.slice(0, 300),
      });
      return;
    }

    type VideoData = {
      uri?: { streaming?: { hls?: string }; hls?: string };
      hls?: string;
      stream?: { hls?: string };
      data?: { uri?: { streaming?: { hls?: string } } };
    };
    const data = (await apiResp.json()) as VideoData;
    const hlsUrl =
      data?.uri?.streaming?.hls ??
      data?.uri?.hls ??
      data?.hls ??
      data?.stream?.hls ??
      data?.data?.uri?.streaming?.hls ??
      null;

    if (!hlsUrl) {
      const keys = data && typeof data === "object" ? Object.keys(data) : [];
      res.status(404).json({ error: "No HLS URL in AnimeonSen API response", keys });
      return;
    }

    res.json({ hlsUrl, ep: epNum, contentId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `AnimeonSen video extraction failed: ${msg}` });
  }
});

/**
 * GET /api/animeonsen/stream?title=...&romajiTitle=...&ep=...
 *
 * Searches AnimeonSen for the given title, resolves the content_id,
 * and returns the direct watch iframe URL for fallback playback.
 */
router.get("/animeonsen/stream", async (req, res) => {
  const title = (req.query.title as string | undefined)?.trim() ?? "";
  const romajiTitle = (req.query.romajiTitle as string | undefined)?.trim() ?? "";
  const ep = (req.query.ep as string | undefined)?.trim() ?? "1";

  if (!title && !romajiTitle) {
    res.status(400).json({ error: "title or romajiTitle is required" });
    return;
  }

  const epNum = parseInt(ep);
  if (isNaN(epNum) || epNum <= 0) {
    res.status(400).json({ error: `Invalid ep: "${ep}"` });
    return;
  }

  const titlesToSearch = [title, romajiTitle].filter(Boolean);
  const result = await searchContentId(titlesToSearch);

  if (!result) {
    res.status(404).json({ error: "AnimeonSen: title not found", searched: titlesToSearch });
    return;
  }

  const { contentId, matchedTitle } = result;
  const iframeUrl = `${ANIMEONSEN_ORIGIN}/watch/${contentId}?episode=${epNum}`;

  res.json({ iframeUrl, contentId, matchedTitle, ep: epNum });
});

export default router;

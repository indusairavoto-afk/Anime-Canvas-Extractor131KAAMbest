/**
 * AnimePahe + kwik.cx streaming route
 *
 * Flow:
 *   1. Search AnimePahe for the anime by title → get anime session ID
 *   2. Paginate episodes list → find the matching episode session
 *   3. Fetch the AnimePahe play page → extract kwik.cx embed URL
 *   4. Fetch kwik.cx embed page → unpack p,a,c,k obfuscated JS → extract M3U8
 *   5. Return { hlsUrl } for native HLS playback
 *
 * animepahe.pw fronts every page with a real Cloudflare Turnstile "Just a
 * moment..." JS challenge — not a plain IP block. Neither the CF-edge relay
 * (MIRURO_RELAY_URL) nor curl_cffi TLS impersonation can solve that; only an
 * actual headless browser running the challenge JS can (see pahe-cf-solver.ts,
 * same approach as the Miruro CF solver). Once solved, the cf_clearance
 * cookie is replayed on plain fetch() calls from this same server IP.
 *
 * kwik.cx itself is NOT behind Cloudflare and is fetched directly.
 */

import { Router } from "express";
import { getCfSession, invalidateCfSession, warmCfSession, setManualSession } from "../lib/pahe-cf-solver.js";

const router = Router();

const PAHE_ORIGIN = "https://animepahe.pw";

// ── Shared headers ─────────────────────────────────────────────────────────

const PAHE_BASE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Referer: `${PAHE_ORIGIN}/`,
  Origin: PAHE_ORIGIN,
};

/**
 * Fetch an animepahe.pw URL with a solved CF Turnstile session's cookies
 * injected. On 403 (session expired / IP rotated), invalidates the cached
 * session and retries once with a freshly solved one.
 */
async function paheFetch(url: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const addSession = async (): Promise<Record<string, string>> => {
    const session = await getCfSession();
    if (!session) return { ...PAHE_BASE_HEADERS, ...extraHeaders };
    return {
      ...PAHE_BASE_HEADERS,
      ...extraHeaders,
      Cookie: session.cookieHeader,
      "User-Agent": session.userAgent,
    };
  };

  const firstHeaders = await addSession();
  const resp = await fetch(url, { headers: firstHeaders });

  if (resp.status === 403 || resp.status === 429) {
    await resp.body?.cancel().catch(() => {});
    invalidateCfSession();
    const retryHeaders = await addSession(); // triggers a fresh solve
    return fetch(url, { headers: retryHeaders });
  }
  return resp;
}

// Warm a CF session in the background at server start so the first user
// request doesn't pay the ~10-20s headless-browser solve cost.
warmCfSession();

// ── In-memory cache ────────────────────────────────────────────────────────

interface PaheAnimeEntry {
  session: string;
  title: string;
  ts: number;
}
const animeSessionCache = new Map<string, PaheAnimeEntry>();
const ANIME_TTL = 6 * 60 * 60 * 1000; // 6 h

interface PaheEpEntry {
  session: string;
  ts: number;
}
const epSessionCache = new Map<string, PaheEpEntry>();
const EP_TTL = 60 * 60 * 1000; // 1 h

// ── AnimePahe API calls ────────────────────────────────────────────────────

async function searchPahe(
  query: string
): Promise<Array<{ session: string; title: string; type: string }>> {
  const url = `${PAHE_ORIGIN}/api?m=search&q=${encodeURIComponent(query)}`;
  const resp = await paheFetch(url, { Accept: "application/json, text/plain, */*" });
  if (!resp.ok) throw new Error(`AnimePahe search HTTP ${resp.status}`);
  const data = (await resp.json()) as {
    data?: Array<{ session: string; title: string; type: string }>;
  };
  return data.data ?? [];
}

interface PaheEpisode {
  id: number;
  episode: number;
  session: string;
  disc?: string;
}
interface PaheEpisodeList {
  data: PaheEpisode[];
  last_page: number;
}

async function getEpisodePage(
  animeSession: string,
  page: number
): Promise<PaheEpisodeList> {
  const url = `${PAHE_ORIGIN}/api?m=release&id=${animeSession}&sort=episode_asc&page=${page}`;
  const resp = await paheFetch(url, { Accept: "application/json, text/plain, */*" });
  if (!resp.ok) throw new Error(`AnimePahe episodes HTTP ${resp.status}`);
  return resp.json() as Promise<PaheEpisodeList>;
}

/** Find the episode session for a given episode number (paginates automatically). */
async function findEpisodeSession(
  animeSession: string,
  epNum: number
): Promise<string | null> {
  const cacheKey = `${animeSession}:${epNum}`;
  const cached = epSessionCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < EP_TTL) return cached.session;

  let page = 1;
  // Estimate starting page (30 eps/page)
  if (epNum > 30) page = Math.max(1, Math.floor((epNum - 1) / 30));

  let lastPage = 999;
  while (page <= lastPage) {
    const list = await getEpisodePage(animeSession, page);
    lastPage = list.last_page;
    const match = list.data.find((e) => Math.round(e.episode) === epNum);
    if (match) {
      epSessionCache.set(cacheKey, { session: match.session, ts: Date.now() });
      return match.session;
    }
    // If episodes on this page are all below target, go forward; if all above, go back
    const maxEp = Math.max(...list.data.map((e) => e.episode));
    const minEp = Math.min(...list.data.map((e) => e.episode));
    if (epNum > maxEp) { page++; continue; }
    if (epNum < minEp) { if (page === 1) return null; page--; continue; }
    // Episode is in range but not matched (could be decimal e.g. 5.5)
    break;
  }
  return null;
}

/** Fetch the AnimePahe play page and extract the kwik.cx embed URL. */
async function getKwikUrl(
  animeSession: string,
  epSession: string
): Promise<string | null> {
  const url = `${PAHE_ORIGIN}/play/${animeSession}/${epSession}`;
  const resp = await paheFetch(url, { Accept: "text/html,application/xhtml+xml,*/*" });
  if (!resp.ok) throw new Error(`AnimePahe play page HTTP ${resp.status}`);
  const html = await resp.text();

  // kwik embed URL is in an <iframe src="https://kwik.cx/e/..."> or in a button attr
  const match =
    html.match(/https:\/\/kwik\.(?:cx|si)\/e\/([A-Za-z0-9]+)/) ??
    html.match(/kwik\.(?:cx|si)\/e\/([A-Za-z0-9]+)/);
  if (!match) return null;
  return `https://kwik.cx/e/${match[1]}`;
}

// ── kwik.cx M3U8 extraction ────────────────────────────────────────────────

/**
 * Standard p,a,c,k JavaScript unpacker.
 * kwik.cx embeds the M3U8 URL inside an eval(function(p,a,c,k,...)) block.
 */
function unpackPACK(html: string): string {
  // Multiline-safe match for the packed payload — kwik uses both `d` and `r` as 6th param.
  // We look for the arguments tuple directly: ('payload',base,count,'k0|k1|...'
  const re =
    /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*(?:d|r)\s*\)[\s\S]*?\(\s*'([\s\S]+?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]+?)'\s*\.split\s*\(\s*'\|'\s*\)/;
  const m = html.match(re);
  if (!m) throw new Error("p,a,c,k pattern not found in kwik page");

  let [, p, a_str, c_str, k_str] = m;
  const a = parseInt(a_str, 10);
  let c = parseInt(c_str, 10);
  const k = k_str.split("|");

  // Base-`a` number → string (handles bases up to 62)
  const toBase = (n: number): string => {
    if (n < a) return n > 35 ? String.fromCharCode(n + 29) : n.toString(36);
    return toBase(Math.floor(n / a)) + (((n = n % a) > 35) ? String.fromCharCode(n + 29) : n.toString(36));
  };

  while (c--) {
    if (k[c]) p = p.replace(new RegExp(`\\b${toBase(c)}\\b`, "g"), k[c]);
  }
  return p;
}

/** Fetch a kwik.cx embed page and return the HLS M3U8 URL. kwik.cx is not behind Cloudflare. */
async function extractM3u8(kwikUrl: string): Promise<string> {
  const resp = await fetch(kwikUrl, {
    headers: {
      "User-Agent": PAHE_BASE_HEADERS["User-Agent"],
      Accept: "text/html,application/xhtml+xml,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: `${PAHE_ORIGIN}/`,
    },
  });
  if (!resp.ok) throw new Error(`kwik.cx embed HTTP ${resp.status}`);
  const html = await resp.text();

  // ── Strategy 1: unpack p,a,c,k and find .m3u8 ────────────────────────
  try {
    const unpacked = unpackPACK(html);
    const m3u8 =
      unpacked.match(/https?:\/\/[^\s'"\\]+\.m3u8[^\s'"\\]*/)?.[0] ??
      unpacked.match(/source['":\s=]+['"]?(https?:\/\/[^'">\s]+\.m3u8[^\s'"]*)/)?.[1];
    if (m3u8) return m3u8;
  } catch {
    // fall through to strategy 2
  }

  // ── Strategy 2: look for raw m3u8 URL in HTML ─────────────────────────
  const direct = html.match(/https?:\/\/[^\s'"<>]+\.m3u8[^\s'"<>]*/)?.[0];
  if (direct) return direct;

  // ── Strategy 3: POST with _token (newer kwik anti-bot) ───────────────
  const tokenMatch = html.match(
    /<input[^>]+name=["']_token["'][^>]+value=["']([^"']+)["']/
  ) ?? html.match(/name="_token"[^>]+value="([^"]+)"/);
  if (tokenMatch) {
    const token = tokenMatch[1];
    const postUrl = kwikUrl.replace("/e/", "/f/");
    const postResp = await fetch(postUrl, {
      method: "POST",
      headers: {
        "User-Agent": PAHE_BASE_HEADERS["User-Agent"],
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: kwikUrl,
        Origin: "https://kwik.cx",
      },
      body: `_token=${encodeURIComponent(token)}`,
    });
    const postHtml = postResp.ok ? await postResp.text() : "";
    const m3u8Post =
      postHtml.match(/https?:\/\/[^\s'"<>]+\.m3u8[^\s'"<>]*/)?.[0];
    if (m3u8Post) return m3u8Post;
    // Strategy 3b: unpack the post response
    try {
      const unpacked = unpackPACK(postHtml);
      const m3u8 = unpacked.match(/https?:\/\/[^\s'"\\]+\.m3u8[^\s'"\\]*/)?.[0];
      if (m3u8) return m3u8;
    } catch { /* ignore */ }
  }

  throw new Error("Could not extract M3U8 from kwik.cx — format may have changed");
}

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/pahe/stream?animeId=&ep=&title=&preferDub=1
 *
 * Returns { hlsUrl, isDub, source } or { error }.
 */
router.get("/pahe/stream", async (req, res) => {
  const { animeId, ep, title, preferDub } = req.query as Record<string, string>;

  if (!animeId || !ep) {
    return res.status(400).json({ error: "animeId and ep are required" });
  }
  if (!title) {
    return res.status(400).json({ error: "title is required for AnimePahe search" });
  }

  const epNum = parseInt(ep, 10);
  if (isNaN(epNum) || epNum < 1) {
    return res.status(400).json({ error: "Invalid episode number" });
  }

  try {
    // ── 1. Resolve AnimePahe anime session ─────────────────────────────
    let animeSession: string | null = null;
    const sessionKey = `pahe_anime_${animeId}`;
    const cachedSession = animeSessionCache.get(sessionKey);
    if (cachedSession && Date.now() - cachedSession.ts < ANIME_TTL) {
      animeSession = cachedSession.session;
    } else {
      // Try full title first, then progressively shorter versions
      const queries = [
        title,
        title.split(":")[0].trim(),
        title.replace(/\s+Season\s+\d+/i, "").trim(),
        title.split(" ").slice(0, 3).join(" "),
      ].filter((q, i, arr) => q.length > 2 && arr.indexOf(q) === i);

      for (const q of queries) {
        const results = await searchPahe(q);
        if (results.length > 0) {
          // Prefer TV type over movies/specials
          const tv = results.find((r) => r.type === "TV") ?? results[0];
          animeSession = tv.session;
          animeSessionCache.set(sessionKey, {
            session: animeSession,
            title: tv.title,
            ts: Date.now(),
          });
          break;
        }
      }
    }

    if (!animeSession) {
      return res.status(404).json({ error: "Anime not found on AnimePahe" });
    }

    // ── 2. Find the episode session ────────────────────────────────────
    const epSession = await findEpisodeSession(animeSession, epNum);
    if (!epSession) {
      return res.status(404).json({
        error: `Episode ${epNum} not found on AnimePahe — may not be released yet`,
      });
    }

    // ── 3. Get kwik.cx embed URL from the play page ────────────────────
    const kwikUrl = await getKwikUrl(animeSession, epSession);
    if (!kwikUrl) {
      return res.status(404).json({ error: "kwik.cx URL not found on AnimePahe play page" });
    }

    // ── 4. Extract M3U8 from kwik.cx ──────────────────────────────────
    const hlsUrl = await extractM3u8(kwikUrl);

    return res.json({
      hlsUrl,
      isDub: false, // AnimePahe/kwik primarily serves subs; dub support TBD
      source: "AnimePahe/kwik.cx",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    (req as any).log?.warn?.({ err: msg }, "pahe/stream error");
    return res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/pahe/search?q=&limit=8
 * Manual search — used to let users correct the anime session if auto-search picks wrong one.
 */
router.get("/pahe/search", async (req, res) => {
  const { q, limit = "8" } = req.query as Record<string, string>;
  if (!q) return res.status(400).json({ error: "q is required" });

  try {
    const results = await searchPahe(q);
    return res.json({ results: results.slice(0, parseInt(limit, 10) || 8) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/pahe/set-cookie
 * Body: { cookie: string, userAgent?: string }
 *
 * animepahe.pw's Cloudflare Private Access Token challenge can only be
 * solved by a genuine browser on real hardware — a headless/scripted
 * browser can never pass it. This endpoint lets a human paste in cookies
 * copied from their own real browser session so the server can reuse them
 * for a while (~2h) to fetch AnimePahe pages.
 *
 * How to get the cookie value:
 *   1. Open https://animepahe.pw in a normal browser and let the security
 *      check finish (you'll land on the real site).
 *   2. Open DevTools (F12) → Network tab → reload the page → click the
 *      first request (animepahe.pw) → find "Cookie" under Request Headers.
 *   3. Copy the ENTIRE cookie header value and paste it as `cookie` below.
 *      (Also fine to copy from Application → Cookies and join as
 *      "name1=value1; name2=value2; ...".)
 */
router.post("/pahe/set-cookie", (req, res) => {
  const { cookie, userAgent } = req.body as { cookie?: string; userAgent?: string };
  if (!cookie || typeof cookie !== "string" || cookie.trim().length < 10) {
    return res.status(400).json({ error: "cookie (string) is required" });
  }
  if (!cookie.includes("cf_clearance")) {
    return res.status(400).json({
      error:
        "cookie header does not contain 'cf_clearance' — make sure you copied the full Cookie header from a request to animepahe.pw after the security check passed",
    });
  }
  setManualSession(cookie, userAgent);
  return res.json({ ok: true, message: "Cookie installed. Valid for ~2 hours." });
});

/**
 * GET /api/pahe/cookie-status
 * Quick check of whether a usable CF session is currently cached.
 */
router.get("/pahe/cookie-status", async (_req, res) => {
  const session = await getCfSession();
  if (!session) return res.json({ hasSession: false });
  return res.json({
    hasSession: true,
    expiresInSeconds: Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000)),
  });
});

/**
 * GET /api/pahe/resolve?url=<animepahe play URL>
 * Directly resolves a specific AnimePahe play page URL (anime+episode session
 * IDs already known) straight to an HLS URL — skips search/episode-list steps.
 */
router.get("/pahe/resolve", async (req, res) => {
  const { url } = req.query as Record<string, string>;
  if (!url) return res.status(400).json({ error: "url is required" });

  const m = url.match(/\/play\/([^/]+)\/([^/?#]+)/);
  if (!m) return res.status(400).json({ error: "Could not parse animeSession/epSession from url" });
  const [, animeSession, epSession] = m;

  try {
    const kwikUrl = await getKwikUrl(animeSession, epSession);
    if (!kwikUrl) {
      return res.status(404).json({ error: "kwik.cx URL not found on AnimePahe play page" });
    }
    const hlsUrl = await extractM3u8(kwikUrl);
    return res.json({ hlsUrl, source: "AnimePahe/kwik.cx" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

export default router;

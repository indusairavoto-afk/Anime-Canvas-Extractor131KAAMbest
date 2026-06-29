import { Router } from "express";

const router = Router();

const ALLANIME_API  = "https://api.allanime.day/allanime/api";
const ALLANIME_HOST = "https://allanime.day";
const ALLANIME_SITE = "https://allanime.to";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Referer":    ALLANIME_SITE + "/",
  "Origin":     ALLANIME_SITE,
  "Accept":     "application/json, text/plain, */*",
};

async function gql(query: string): Promise<unknown> {
  const url = `${ALLANIME_API}?variables=%7B%7D&query=${encodeURIComponent(query)}`;
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`AllAnime GQL ${r.status}`);
  return r.json();
}

/** Decode AllAnime's "-base64" encoded source URLs → full URL */
function decodeSourceUrl(raw: string): string | null {
  if (!raw.startsWith("-")) {
    return raw.startsWith("http") ? raw : null;
  }
  try {
    const b64 = raw.slice(1).replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const path = Buffer.from(b64 + pad, "base64").toString("utf8");
    if (path.startsWith("/")) return `${ALLANIME_HOST}${path}`;
    if (path.startsWith("http")) return path;
    return null;
  } catch {
    return null;
  }
}

interface ClockLink { link: string; resolutionStr?: string; mp4?: boolean }

/** Call the AllAnime clock endpoint → best HLS or mp4 URL */
async function resolveClock(clockUrl: string): Promise<string | null> {
  try {
    const r = await fetch(clockUrl, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const json = await r.json() as { links?: ClockLink[] };
    const links = json.links ?? [];
    const sorted = [...links].sort((a, b) => {
      if (!!a.mp4 !== !!b.mp4) return a.mp4 ? 1 : -1; // prefer HLS (non-mp4)
      const ra = parseInt(a.resolutionStr ?? "0") || 0;
      const rb = parseInt(b.resolutionStr ?? "0") || 0;
      return rb - ra; // highest resolution first
    });
    return sorted[0]?.link ?? null;
  } catch {
    return null;
  }
}

interface SourceUrlEntry { sourceUrl?: string; sourceName?: string; priority?: number }

/**
 * GET /api/allanime/stream?anilistId=&ep=&dub=&title=
 * Returns a direct HLS/mp4 URL by querying AllAnime's public GraphQL API.
 */
router.get("/allanime/stream", async (req, res) => {
  const anilistId = parseInt((req.query.anilistId as string | undefined) ?? "0");
  const ep        = ((req.query.ep as string | undefined) ?? "").trim();
  const dub       = req.query.dub === "true" || req.query.dub === "1";
  const titleHint = ((req.query.title as string | undefined) ?? "").trim();
  const transType = dub ? "dub" : "sub";

  if (!anilistId || !ep) {
    res.status(400).json({ error: "anilistId and ep are required" });
    return;
  }

  try {
    // ── Step 1: find the show on AllAnime ──────────────────────────────────
    let showId: string | null = null;
    let showName = "";

    // Primary: look up by AniList ID
    const byId = await gql(`{
      shows(search: { aniListId: ${anilistId} } limit: 1 translationType: ${transType}) {
        edges { _id name availableEpisodesDetail }
      }
    }`) as { data?: { shows?: { edges?: Array<{ _id: string; name: string }> } } };

    const idHit = byId?.data?.shows?.edges?.[0];
    if (idHit) {
      showId   = idHit._id;
      showName = idHit.name;
    }

    // Fallback: search by title if AniList ID lookup found nothing
    if (!showId && titleHint) {
      const byTitle = await gql(`{
        shows(search: { query: ${JSON.stringify(titleHint)} } limit: 5 translationType: ${transType}) {
          edges { _id name availableEpisodesDetail }
        }
      }`) as { data?: { shows?: { edges?: Array<{ _id: string; name: string; availableEpisodesDetail?: Record<string, string[]> }> } } };

      const hits = byTitle?.data?.shows?.edges ?? [];
      // Prefer an exact-ish title match
      const best = hits.find(h => h.name.toLowerCase().includes(titleHint.toLowerCase().slice(0, 12))) ?? hits[0];
      if (best) {
        showId   = best._id;
        showName = best.name;
      }
    }

    if (!showId) {
      res.status(404).json({ error: "Show not found on AllAnime" });
      return;
    }

    // ── Step 2: get episode source URLs ────────────────────────────────────
    const epData = await gql(`{
      episode(showId: ${JSON.stringify(showId)} translationType: ${transType} episodeString: ${JSON.stringify(ep)}) {
        sourceUrls
      }
    }`) as { data?: { episode?: { sourceUrls?: SourceUrlEntry[] } } };

    const rawSources = epData?.data?.episode?.sourceUrls;
    if (!rawSources?.length) {
      res.status(404).json({ error: "No episode sources on AllAnime" });
      return;
    }

    // Sort by priority descending — AllAnime CDN sources score highest
    const sorted = [...rawSources].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    // ── Step 3: resolve source URLs → actual stream ─────────────────────────
    let hlsUrl: string | null = null;

    for (const src of sorted) {
      const raw = src.sourceUrl ?? "";
      if (!raw) continue;

      const decoded = decodeSourceUrl(raw);
      if (!decoded) continue;

      // AllAnime CDN clock endpoint → gives real HLS links
      if (decoded.includes("allanime.day") || decoded.includes("/clock")) {
        hlsUrl = await resolveClock(decoded);
        if (hlsUrl) break;
        continue;
      }

      // If the URL is already a direct m3u8 / mp4, use it
      if (decoded.match(/\.(m3u8|mp4)(\?|$)/i)) {
        hlsUrl = decoded;
        break;
      }
    }

    if (!hlsUrl) {
      res.status(404).json({ error: "Could not resolve a playable stream from AllAnime" });
      return;
    }

    res.json({ hlsUrl, showId, showName });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: `AllAnime error: ${msg}` });
  }
});

export default router;

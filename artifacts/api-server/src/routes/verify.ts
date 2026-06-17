import { Router } from "express";

const router = Router();

/**
 * Extract an episode number from a source page title string.
 * Handles formats like:
 *   "Watch Attack on Titan Episode 5 HD Online"
 *   "Naruto - Episode 047"
 *   "shingeki-no-kyojin-episode-5"
 *   "One Piece Ep. 1050"
 *   "Demon Slayer EP3"
 */
function extractEpisodeNumber(sourceTitle: string): number | null {
  if (!sourceTitle) return null;

  // "Episode 5", "Episode 047", "Ep 5", "Ep. 5", "EP3"
  const patterns = [
    /\bepisode[.\s-]*(\d+)/i,
    /\bep[.\s-]*(\d+)/i,
    /-episode-(\d+)/i,
    /\s(\d+)\s*(?:hd|online|sub|dub|$)/i,
  ];

  for (const re of patterns) {
    const m = sourceTitle.match(re);
    if (m?.[1]) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > 0 && n < 10000) return n;
    }
  }
  return null;
}

/**
 * Normalise a title for fuzzy comparison.
 * Strips punctuation, extra spaces, common suffixes.
 */
function normaliseTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compute word-overlap ratio between two normalised title strings.
 */
function titleOverlap(a: string, b: string): number {
  const aw = new Set(a.split(" ").filter((w) => w.length > 1));
  const bw = b.split(" ").filter((w) => w.length > 1);
  if (aw.size === 0 || bw.length === 0) return 0;
  const matches = bw.filter((w) => aw.has(w)).length;
  return matches / Math.max(aw.size, bw.length);
}

type Confidence = "high" | "medium" | "low";

interface VerifyResult {
  correct: boolean;
  confidence: Confidence;
  reason: string;
  extractedEpisode: number | null;
}

function verifyEpisode(
  animeTitle: string,
  episodeNumber: number,
  sourceTitle: string,
  jikanEpTitle?: string | null,
): VerifyResult {
  const extractedEp = extractEpisodeNumber(sourceTitle);

  const normAnime = normaliseTitle(animeTitle);
  const normSource = normaliseTitle(sourceTitle);
  const overlap = titleOverlap(normAnime, normSource);

  // ── Check 1: episode number mismatch ───────────────────────────────────────
  if (extractedEp !== null) {
    const diff = Math.abs(extractedEp - episodeNumber);
    if (diff === 0) {
      // Episode number confirmed correct — combine with title check for confidence
      if (overlap >= 0.4) {
        return {
          correct: true,
          confidence: "high",
          reason: `Episode ${extractedEp} confirmed — title matches (${Math.round(overlap * 100)}% overlap)`,
          extractedEpisode: extractedEp,
        };
      }
      // Episode number matches but titles differ — could be Japanese vs English title (common on GoGo)
      const isKnownSource = /gogoanimes|anikoto|anizone/i.test(sourceTitle);
      return {
        correct: true,
        confidence: isKnownSource ? "medium" : "low",
        reason: `Episode ${extractedEp} confirmed — title may differ (${animeTitle} vs source title)`,
        extractedEpisode: extractedEp,
      };
    } else if (diff <= 1) {
      // Off-by-one: could be numbering offset (e.g. recap counted differently)
      return {
        correct: true,
        confidence: "medium",
        reason: `Episode number close (source shows ep ${extractedEp}, expected ${episodeNumber}) — may be a numbering offset`,
        extractedEpisode: extractedEp,
      };
    } else {
      return {
        correct: false,
        confidence: "high",
        reason: `Wrong episode: source shows episode ${extractedEp} but you requested episode ${episodeNumber}`,
        extractedEpisode: extractedEp,
      };
    }
  }

  // ── Check 2: no episode number found — rely on title match ─────────────────

  // If source title contains the anime title words at decent overlap → good
  if (overlap >= 0.5) {
    return {
      correct: true,
      confidence: "medium",
      reason: `Title match (${Math.round(overlap * 100)}% word overlap) — episode looks correct`,
      extractedEpisode: extractedEp,
    };
  }

  // ── Check 3: Jikan episode title in source ──────────────────────────────────
  if (jikanEpTitle) {
    const normJikan = normaliseTitle(jikanEpTitle);
    if (normSource.includes(normJikan.slice(0, 20)) && normJikan.length > 5) {
      return {
        correct: true,
        confidence: "high",
        reason: `Jikan episode title found in source: "${jikanEpTitle}"`,
        extractedEpisode: extractedEp,
      };
    }
  }

  // ── Check 4: "gogoanimes" / "anikoto" / "anizone" in source — trusted streams
  const isKnownSource =
    /gogoanimes|anikoto|anizone|anikoto\.cz|gogoanimes\.cv/i.test(sourceTitle);

  if (isKnownSource && overlap >= 0.2) {
    return {
      correct: true,
      confidence: "low",
      reason: `Known source — title may differ from AniList (${Math.round(overlap * 100)}% overlap)`,
      extractedEpisode: extractedEp,
    };
  }

  // ── Titles clearly don't match ─────────────────────────────────────────────
  if (overlap < 0.15 && normSource.length > 10) {
    return {
      correct: false,
      confidence: "medium",
      reason: `Title mismatch: source "${sourceTitle.slice(0, 60)}" doesn't match "${animeTitle}"`,
      extractedEpisode: extractedEp,
    };
  }

  return {
    correct: true,
    confidence: "low",
    reason: "Could not conclusively verify — assuming correct",
    extractedEpisode: extractedEp,
  };
}

/**
 * POST /api/verify-episode
 * Body: { animeTitle, episodeNumber, sourceTitle, jikanEpTitle? }
 * Returns: { correct, confidence, reason, extractedEpisode }
 *
 * Intelligently checks whether the source stream title matches the expected
 * anime episode. Uses multi-pass heuristics:
 *   1. Extract episode number from the source page title
 *   2. Compare to expected episode number
 *   3. Fuzzy-match the anime title against the source title
 *   4. Cross-check with Jikan episode title if provided
 */
router.post("/verify-episode", (req, res) => {
  const { animeTitle, episodeNumber, sourceTitle, jikanEpTitle } = req.body as {
    animeTitle?: string;
    episodeNumber?: number;
    sourceTitle?: string;
    jikanEpTitle?: string | null;
  };

  if (!animeTitle || !episodeNumber || !sourceTitle) {
    return res.status(400).json({ error: "animeTitle, episodeNumber, and sourceTitle are required" });
  }

  const result = verifyEpisode(animeTitle, episodeNumber, sourceTitle, jikanEpTitle);
  return res.json(result);
});

/**
 * GET /api/verify-episode?animeTitle=...&episodeNumber=...&sourceTitle=...&jikanEpTitle=...
 * Convenience GET version for easy browser testing.
 */
router.get("/verify-episode", (req, res) => {
  const animeTitle = (req.query.animeTitle as string | undefined)?.trim();
  const episodeNumber = parseInt((req.query.episodeNumber as string) || "0");
  const sourceTitle = (req.query.sourceTitle as string | undefined)?.trim();
  const jikanEpTitle = (req.query.jikanEpTitle as string | undefined)?.trim() || null;

  if (!animeTitle || !episodeNumber || !sourceTitle) {
    return res.status(400).json({ error: "animeTitle, episodeNumber, and sourceTitle are required" });
  }

  const result = verifyEpisode(animeTitle, episodeNumber, sourceTitle, jikanEpTitle);
  return res.json(result);
});

export default router;

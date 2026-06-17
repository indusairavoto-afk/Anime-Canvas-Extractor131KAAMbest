import { Router } from "express";

const router = Router();

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const VERIFY_MODEL = "openai/gpt-4o-mini";

function extractEpisodeNumber(sourceTitle: string): number | null {
  if (!sourceTitle) return null;
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

function normaliseTitle(t: string): string {
  return t.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

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
  aiPowered?: boolean;
}

function verifyHeuristic(
  animeTitle: string,
  episodeNumber: number,
  sourceTitle: string,
  jikanEpTitle?: string | null,
): VerifyResult {
  const extractedEp = extractEpisodeNumber(sourceTitle);
  const normAnime = normaliseTitle(animeTitle);
  const normSource = normaliseTitle(sourceTitle);
  const overlap = titleOverlap(normAnime, normSource);

  if (extractedEp !== null) {
    const diff = Math.abs(extractedEp - episodeNumber);
    if (diff === 0) {
      if (overlap >= 0.4) return { correct: true, confidence: "high", reason: `Episode ${extractedEp} confirmed — title matches (${Math.round(overlap * 100)}% overlap)`, extractedEpisode: extractedEp };
      const isKnownSource = /gogoanimes|anikoto|anizone|miruro/i.test(sourceTitle);
      return { correct: true, confidence: isKnownSource ? "medium" : "low", reason: `Episode ${extractedEp} confirmed — title may differ`, extractedEpisode: extractedEp };
    } else if (diff <= 1) {
      return { correct: true, confidence: "medium", reason: `Episode close (source ep ${extractedEp}, expected ${episodeNumber}) — numbering offset?`, extractedEpisode: extractedEp };
    } else {
      return { correct: false, confidence: "high", reason: `Wrong episode: source ep ${extractedEp} ≠ expected ep ${episodeNumber}`, extractedEpisode: extractedEp };
    }
  }

  if (overlap >= 0.5) return { correct: true, confidence: "medium", reason: `Title match (${Math.round(overlap * 100)}% overlap)`, extractedEpisode: null };

  if (jikanEpTitle) {
    const normJikan = normaliseTitle(jikanEpTitle);
    if (normSource.includes(normJikan.slice(0, 20)) && normJikan.length > 5) {
      return { correct: true, confidence: "high", reason: `Jikan episode title found in source: "${jikanEpTitle}"`, extractedEpisode: null };
    }
  }

  const isKnownSource = /gogoanimes|anikoto|anizone|miruro/i.test(sourceTitle);
  if (isKnownSource && overlap >= 0.2) return { correct: true, confidence: "low", reason: `Known source — title may differ (${Math.round(overlap * 100)}% overlap)`, extractedEpisode: null };
  if (overlap < 0.15 && normSource.length > 10) return { correct: false, confidence: "medium", reason: `Title mismatch: "${sourceTitle.slice(0, 60)}" vs "${animeTitle}"`, extractedEpisode: null };
  return { correct: true, confidence: "low", reason: "Could not conclusively verify — assuming correct", extractedEpisode: null };
}

async function verifyWithAI(
  animeTitle: string,
  episodeNumber: number,
  sourceTitle: string,
  jikanEpTitle: string | null | undefined,
): Promise<VerifyResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const resp = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://anime.replit.app",
        "X-Title": "NA Anime Episode Verifier",
      },
      body: JSON.stringify({
        model: VERIFY_MODEL,
        messages: [
          {
            role: "system",
            content: `You verify if an anime streaming source is showing the correct episode. Consider: Japanese vs English titles, different season numbering systems, sequel series IDs, and common streaming site title formats. Respond ONLY with valid JSON matching: {"correct":bool,"confidence":"high"|"medium"|"low","reason":"short explanation","extractedEpisode":number|null}`,
          },
          {
            role: "user",
            content: `Anime: "${animeTitle}"\nExpected episode: ${episodeNumber}\nSource page title: "${sourceTitle}"${jikanEpTitle ? `\nMAL episode title: "${jikanEpTitle}"` : ""}`,
          },
        ],
        temperature: 0,
        max_tokens: 150,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!resp.ok) return null;
    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as VerifyResult;
    return { ...parsed, aiPowered: true };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * POST /api/verify-episode
 * Body: { animeTitle, episodeNumber, sourceTitle, jikanEpTitle? }
 */
router.post("/verify-episode", async (req, res) => {
  const { animeTitle, episodeNumber, sourceTitle, jikanEpTitle } = req.body as {
    animeTitle?: string;
    episodeNumber?: number;
    sourceTitle?: string;
    jikanEpTitle?: string | null;
  };

  if (!animeTitle || !episodeNumber || !sourceTitle) {
    return res.status(400).json({ error: "animeTitle, episodeNumber, and sourceTitle are required" });
  }

  const heuristic = verifyHeuristic(animeTitle, episodeNumber, sourceTitle, jikanEpTitle);

  // High-confidence heuristic result → skip AI call (faster response)
  if (heuristic.confidence === "high") {
    return res.json(heuristic);
  }

  // Low/medium confidence → ask AI for a better answer
  const aiResult = await verifyWithAI(animeTitle, episodeNumber, sourceTitle, jikanEpTitle);
  return res.json(aiResult ?? heuristic);
});

router.get("/verify-episode", async (req, res) => {
  const animeTitle = (req.query.animeTitle as string | undefined)?.trim();
  const episodeNumber = parseInt((req.query.episodeNumber as string) || "0");
  const sourceTitle = (req.query.sourceTitle as string | undefined)?.trim();
  const jikanEpTitle = (req.query.jikanEpTitle as string | undefined)?.trim() || null;

  if (!animeTitle || !episodeNumber || !sourceTitle) {
    return res.status(400).json({ error: "animeTitle, episodeNumber, and sourceTitle are required" });
  }

  const heuristic = verifyHeuristic(animeTitle, episodeNumber, sourceTitle, jikanEpTitle);
  if (heuristic.confidence === "high") return res.json(heuristic);
  const aiResult = await verifyWithAI(animeTitle, episodeNumber, sourceTitle, jikanEpTitle);
  return res.json(aiResult ?? heuristic);
});

export default router;

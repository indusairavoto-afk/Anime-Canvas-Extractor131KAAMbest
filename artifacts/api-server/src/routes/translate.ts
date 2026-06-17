import { Router } from "express";

const router = Router();

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "openai/gpt-4o-mini";
const MAX_CUES_PER_BATCH = 250;

interface VttCue {
  id?: string;
  timing: string;
  text: string;
}

function parseVtt(content: string): VttCue[] {
  const cues: VttCue[] = [];
  const blocks = content.replace(/\r\n/g, "\n").split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (!lines.length) continue;

    let i = 0;
    let id: string | undefined;

    if (!lines[i]?.includes("-->") && i + 1 < lines.length && lines[i + 1]?.includes("-->")) {
      const first = lines[i].trim();
      if (first && !first.startsWith("WEBVTT") && !first.startsWith("NOTE") && !first.startsWith("STYLE")) {
        id = first;
        i++;
      } else {
        continue;
      }
    }

    const timingLine = lines[i]?.trim();
    if (!timingLine?.includes("-->")) continue;
    i++;

    const textLines: string[] = [];
    while (i < lines.length) {
      textLines.push(lines[i]);
      i++;
    }

    const text = textLines.join("\n").trim();
    if (!text) continue;

    cues.push({ id, timing: timingLine, text });
  }

  return cues;
}

function rebuildVtt(cues: VttCue[], translated: (string | null)[]): string {
  let out = "WEBVTT\n\n";
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (cue.id) out += cue.id + "\n";
    out += cue.timing + "\n";
    out += (translated[i] ?? cue.text) + "\n\n";
  }
  return out;
}

async function callOpenRouter(
  texts: string[],
  targetLangName: string,
): Promise<string[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const numbered = texts.map((t, i) => `${i + 1}|||${t.replace(/\n/g, "\\n")}`).join("\n");

  const resp = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://anime.replit.app",
      "X-Title": "NA Anime Subtitle Translator",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `You are a professional anime subtitle translator. Translate subtitle lines to ${targetLangName}. Rules: keep the same numbered format "N|||translation", preserve \\n within a line for multi-line cues, keep character names and honorifics natural, do NOT add explanations or extra lines. Return ONLY the numbered translations.`,
        },
        { role: "user", content: numbered },
      ],
      temperature: 0.2,
      max_tokens: Math.min(texts.length * 50 + 200, 8000),
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`OpenRouter ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? "";

  const result: string[] = texts.map((t) => t);
  for (const line of content.split("\n")) {
    const m = line.match(/^(\d+)\|\|\|(.*)$/);
    if (m) {
      const idx = parseInt(m[1]) - 1;
      if (idx >= 0 && idx < texts.length) {
        result[idx] = m[2].trim().replace(/\\n/g, "\n");
      }
    }
  }
  return result;
}

async function translateBatched(
  cues: VttCue[],
  targetLangName: string,
): Promise<(string | null)[]> {
  const translated: (string | null)[] = new Array(cues.length).fill(null);

  for (let start = 0; start < cues.length; start += MAX_CUES_PER_BATCH) {
    const batch = cues.slice(start, start + MAX_CUES_PER_BATCH);
    const texts = batch.map((c) => c.text);
    try {
      const results = await callOpenRouter(texts, targetLangName);
      for (let j = 0; j < results.length; j++) {
        translated[start + j] = results[j];
      }
    } catch {
      // leave nulls — rebuildVtt falls back to original
    }
  }

  return translated;
}

/**
 * POST /api/translate-subtitle
 * Body: { vttUrl: string, targetLang: string, targetLangName: string }
 * Returns: { vtt: string }
 */
router.post("/translate-subtitle", async (req, res) => {
  const { vttUrl, targetLang, targetLangName } = req.body as {
    vttUrl?: string;
    targetLang?: string;
    targetLangName?: string;
  };

  if (!vttUrl || !targetLang || !targetLangName) {
    return res.status(400).json({ error: "vttUrl, targetLang, and targetLangName are required" });
  }

  try {
    const upstreamResp = await fetch(vttUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; subtitle-fetcher)",
        "Accept": "text/vtt, text/plain, */*",
      },
    });

    if (!upstreamResp.ok) {
      return res.status(502).json({ error: `Failed to fetch subtitle: ${upstreamResp.status}` });
    }

    const raw = await upstreamResp.text();
    const cues = parseVtt(raw);

    if (!cues.length) {
      return res.status(422).json({ error: "No subtitle cues found in the file" });
    }

    const translated = await translateBatched(cues, targetLangName);
    const vtt = rebuildVtt(cues, translated);

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.json({ vtt, cues: cues.length, lang: targetLang });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    req.log.warn({ err, vttUrl, targetLang }, "translate-subtitle failed");
    return res.status(502).json({ error: msg });
  }
});

export default router;

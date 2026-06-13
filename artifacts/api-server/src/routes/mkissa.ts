import { Router } from "express";

const router = Router();

const ALLANIME_API = "https://api.allanime.day/api";

const GQL_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Content-Type": "application/json",
  "Referer": "https://mkissa.to/",
  "Origin": "https://mkissa.to",
  "Accept": "application/json",
};

async function searchAllanime(query: string, limit = 10): Promise<{ _id: string; name: string; thumbnail: string }[]> {
  const resp = await fetch(ALLANIME_API, {
    method: "POST",
    headers: GQL_HEADERS,
    body: JSON.stringify({
      query: `query($search:SearchInput){shows(search:$search,limit:${limit},page:1,translationType:sub,countryOrigin:JP){edges{_id name thumbnail}}}`,
      variables: { search: { query, allowAdult: false } },
    }),
  });
  if (!resp.ok) return [];
  const data = await resp.json() as { data?: { shows?: { edges?: { _id: string; name: string; thumbnail: string }[] } } };
  return data?.data?.shows?.edges ?? [];
}

/**
 * GET /api/mkissa/search?q={title}&limit={n}
 * Returns AllAnime show matches — _id is used to build mkissa.to/anime/{_id}?ep={N}
 */
router.get("/mkissa/search", async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  const limit = Math.min(parseInt((req.query.limit as string) || "10"), 20);

  if (!q) return res.status(400).json({ error: "q query param required", results: [] });

  try {
    const results = await searchAllanime(q, limit);
    return res.json({ results, query: q, total: results.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.status(502).json({ error: msg, results: [] });
  }
});

export default router;

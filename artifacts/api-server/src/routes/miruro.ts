import { Router } from "express";

const router = Router();

const MIRURO_SITE = "https://www.miruro.to";

/**
 * Convert a romaji title to a miruro.to URL slug.
 * e.g. "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season"
 *   → "rezero-kara-hajimeru-isekai-seikatsu-4th-season"
 */
function toMiruroSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * GET /api/miruro/stream?anilistId=...&ep=...&romajiTitle=...
 *
 * Returns an iframe URL for miruro.to.
 * romajiTitle is used to construct the slug portion of the URL.
 * If omitted, the URL is constructed without a slug (miruro.to handles it).
 */
router.get("/miruro/stream", async (req, res) => {
  const anilistId = (req.query.anilistId as string | undefined)?.trim();
  const ep = (req.query.ep as string | undefined)?.trim();
  const romajiTitle = (req.query.romajiTitle as string | undefined)?.trim();

  if (!anilistId || !ep) {
    return res.status(400).json({ error: "anilistId and ep query params are required" });
  }

  const epNum = parseInt(ep);
  if (isNaN(epNum) || epNum <= 0) {
    return res.status(400).json({ error: `Invalid ep value: "${ep}"` });
  }

  const slug = romajiTitle ? toMiruroSlug(romajiTitle) : null;
  const iframeUrl = slug
    ? `${MIRURO_SITE}/watch/${anilistId}/${slug}?ep=${epNum}`
    : `${MIRURO_SITE}/watch/${anilistId}?ep=${epNum}`;

  return res.json({ iframeUrl });
});

export default router;

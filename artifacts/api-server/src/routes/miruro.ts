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
 * Returns an iframe URL for miruro.to only if the URL is actually embeddable.
 * Performs a HEAD check to verify no X-Frame-Options block is in place.
 * Returns 503 if the source cannot be iframed (sitewide SAMEORIGIN policy).
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

  // Verify the URL is actually embeddable before advertising it to the frontend.
  // miruro.to uses X-Frame-Options: SAMEORIGIN sitewide, which prevents iframe
  // embedding. If that changes in the future, this check will automatically allow it.
  try {
    const check = await fetch(iframeUrl, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    const xfo = check.headers.get("x-frame-options");
    if (xfo) {
      const xfoLower = xfo.toLowerCase().trim();
      // SAMEORIGIN and DENY both block cross-origin embedding
      if (xfoLower === "sameorigin" || xfoLower === "deny") {
        return res.status(503).json({ error: "Stream source not embeddable (X-Frame-Options: " + xfo + ")" });
      }
    }
  } catch {
    return res.status(503).json({ error: "Stream source unavailable" });
  }

  return res.json({ iframeUrl });
});

export default router;

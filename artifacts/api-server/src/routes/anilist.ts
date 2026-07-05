import { Router } from "express";

const router = Router();

// This route is kept for backwards compatibility but Replit's datacenter IP is
// hard-blocked by AniList. The frontend now calls graphql.anilist.co directly
// via the anilistFetch() helper in src/lib/api.ts.
router.post("/anilist", (_req, res) => {
  res.status(503).json({ error: "AniList proxy disabled — use direct browser fetch" });
});

export default router;

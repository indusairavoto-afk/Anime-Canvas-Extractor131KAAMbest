import { Router } from "express";

const router = Router();

router.post("/anilist", async (req, res) => {
  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "AniList request failed" });
  }
});

export default router;

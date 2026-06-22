import { Router } from "express";
import { db } from "@workspace/db";
import { reviewTable } from "@workspace/db";
import { eq, and, desc, sql, isNotNull } from "drizzle-orm";

const router = Router();

const VALID_RATINGS = ["skip", "timepass", "go_for_it", "perfection"] as const;

function randomAvatar(username: string) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`;
}

function toReviewResponse(row: typeof reviewTable.$inferSelect) {
  return {
    id: row.id,
    animeId: row.animeId,
    episode: row.episode,
    username: row.username,
    avatarUrl: row.avatarUrl,
    rating: row.rating,
    content: row.content,
    spoiler: row.spoiler,
    likes: row.likes,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Anime-level reviews ──────────────────────────────────────────────────────

router.get("/anime/:id/reviews", async (req, res) => {
  try {
    const animeId = parseInt(req.params.id);
    const rows = await db
      .select()
      .from(reviewTable)
      .where(eq(reviewTable.animeId, animeId))
      .orderBy(desc(reviewTable.createdAt));
    res.json(rows.map(toReviewResponse));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/anime/:id/reviews", async (req, res) => {
  try {
    const animeId = parseInt(req.params.id);
    const { username, rating, content, spoiler } = req.body;

    if (!username || typeof username !== "string") {
      res.status(400).json({ error: "username is required" }); return;
    }
    if (!rating || !VALID_RATINGS.includes(rating)) {
      res.status(400).json({ error: "rating must be one of: skip, timepass, go_for_it, perfection" }); return;
    }
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      res.status(400).json({ error: "content is required" }); return;
    }

    const [row] = await db
      .insert(reviewTable)
      .values({
        animeId,
        username,
        avatarUrl: randomAvatar(username),
        rating,
        content: content.trim(),
        spoiler: spoiler === true,
        likes: 0,
      })
      .returning();
    res.status(201).json(toReviewResponse(row));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Episode-level reviews ────────────────────────────────────────────────────

router.get("/anime/:id/episode/:ep/reviews", async (req, res) => {
  try {
    const animeId = parseInt(req.params.id);
    const episode = parseInt(req.params.ep);
    const rows = await db
      .select()
      .from(reviewTable)
      .where(and(eq(reviewTable.animeId, animeId), eq(reviewTable.episode, episode)))
      .orderBy(desc(reviewTable.likes), desc(reviewTable.createdAt));
    res.json(rows.map(toReviewResponse));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/anime/:id/episode/:ep/reviews", async (req, res) => {
  try {
    const animeId = parseInt(req.params.id);
    const episode = parseInt(req.params.ep);
    const { username, rating, content, spoiler, voterKey } = req.body;

    if (!username || typeof username !== "string") {
      res.status(400).json({ error: "username is required" }); return;
    }
    if (!rating || !VALID_RATINGS.includes(rating)) {
      res.status(400).json({ error: "Invalid rating" }); return;
    }
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      res.status(400).json({ error: "content is required" }); return;
    }

    const [row] = await db
      .insert(reviewTable)
      .values({
        animeId,
        episode,
        username,
        avatarUrl: randomAvatar(username),
        voterKey: voterKey ?? null,
        rating,
        content: content.trim(),
        spoiler: spoiler === true,
        likes: 0,
      })
      .returning();
    res.status(201).json(toReviewResponse(row));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Like a review ────────────────────────────────────────────────────────────

router.post("/reviews/:id/like", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db
      .update(reviewTable)
      .set({ likes: sql`${reviewTable.likes} + 1` })
      .where(eq(reviewTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Review not found" }); return; }
    res.json(toReviewResponse(row));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/anime/:id/reviews/summary", async (req, res) => {
  try {
    const animeId = parseInt(req.params.id);
    const rows = await db
      .select()
      .from(reviewTable)
      .where(eq(reviewTable.animeId, animeId));

    const summary = { skip: 0, timepass: 0, go_for_it: 0, perfection: 0, total: rows.length };
    for (const row of rows) summary[row.rating]++;
    res.json(summary);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

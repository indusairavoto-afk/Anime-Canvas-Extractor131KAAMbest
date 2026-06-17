import { Router } from "express";
import { db } from "@workspace/db";
import { reviewReplyTable } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";

const router = Router();

function randomAvatar(username: string) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`;
}

router.get("/reviews/:id/replies", async (req, res) => {
  try {
    const reviewId = parseInt(req.params.id);
    const rows = await db.select().from(reviewReplyTable)
      .where(eq(reviewReplyTable.reviewId, reviewId))
      .orderBy(asc(reviewReplyTable.createdAt));
    res.json(rows.map(r => ({
      id: r.id,
      reviewId: r.reviewId,
      username: r.username,
      avatarUrl: r.avatarUrl,
      content: r.content,
      likes: r.likes,
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/reviews/:id/replies", async (req, res) => {
  try {
    const reviewId = parseInt(req.params.id);
    const { username, content } = req.body;
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      res.status(400).json({ error: "content is required" });
      return;
    }
    const name = (username || "Guest").trim();
    const [row] = await db.insert(reviewReplyTable).values({
      reviewId,
      username: name,
      avatarUrl: randomAvatar(name),
      content: content.trim(),
      likes: 0,
    }).returning();
    res.status(201).json({
      id: row.id,
      reviewId: row.reviewId,
      username: row.username,
      avatarUrl: row.avatarUrl,
      content: row.content,
      likes: row.likes,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

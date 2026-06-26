import { Router } from "express";
import { db } from "@workspace/db";
import { commentTable, communityPostTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { writeLimiter, voteLimiter } from "../lib/rate-limiters";

const router = Router();

function randomAvatar(username: string) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`;
}

router.get("/episodes/:id/comments", async (req, res) => {
  try {
    const episodeId = parseInt(req.params.id);
    const rows = await db
      .select()
      .from(commentTable)
      .where(eq(commentTable.episodeId, episodeId))
      .orderBy(commentTable.createdAt);
    res.json(rows.map(toCommentResponse));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/episodes/:id/comments", writeLimiter, async (req, res) => {
  try {
    const episodeId = parseInt(req.params.id);
    if (isNaN(episodeId)) { res.status(400).json({ error: "Invalid episode id" }); return; }
    const { username, content, parentId } = req.body;
    if (!username || typeof username !== "string" || username.trim().length === 0) {
      res.status(400).json({ error: "username is required" }); return;
    }
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      res.status(400).json({ error: "content cannot be empty" }); return;
    }
    if (content.trim().length > 2000) {
      res.status(400).json({ error: "content must be under 2000 characters" }); return;
    }
    const [row] = await db
      .insert(commentTable)
      .values({
        episodeId,
        username: username.trim(),
        content: content.trim(),
        avatarUrl: randomAvatar(username.trim()),
        parentId: parentId ?? null,
        likes: 0,
      })
      .returning();
    res.status(201).json(toCommentResponse(row));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/comments/:id/like", voteLimiter, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db
      .update(commentTable)
      .set({ likes: sql`${commentTable.likes} + 1` })
      .where(eq(commentTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Comment not found" }); return; }
    res.json(toCommentResponse(row));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/comments/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid comment id" }); return; }
    const { username } = req.body;
    if (!username || typeof username !== "string") {
      res.status(400).json({ error: "username is required" }); return;
    }
    const [comment] = await db.select().from(commentTable).where(eq(commentTable.id, id)).limit(1);
    if (!comment) { res.status(404).json({ error: "Comment not found" }); return; }
    if (comment.username !== username.trim()) { res.status(403).json({ error: "You can only delete your own comments" }); return; }
    await db.delete(commentTable).where(eq(commentTable.id, id));
    // Decrement commentCount on the parent post if applicable
    if (comment.communityPostId) {
      await db.update(communityPostTable).set({ commentCount: sql`GREATEST(${communityPostTable.commentCount} - 1, 0)` }).where(eq(communityPostTable.id, comment.communityPostId));
    }
    res.status(204).end();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export function toCommentResponse(row: typeof commentTable.$inferSelect) {
  return {
    id: row.id,
    username: row.username,
    avatarUrl: row.avatarUrl,
    content: row.content,
    likes: row.likes,
    createdAt: row.createdAt.toISOString(),
    parentId: row.parentId ?? null,
  };
}

export default router;

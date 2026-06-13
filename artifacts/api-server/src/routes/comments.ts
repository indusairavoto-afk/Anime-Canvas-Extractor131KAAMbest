import { Router } from "express";
import { db } from "@workspace/db";
import { commentTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

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

router.post("/episodes/:id/comments", async (req, res) => {
  try {
    const episodeId = parseInt(req.params.id);
    const { username, content, parentId } = req.body;
    const [row] = await db
      .insert(commentTable)
      .values({
        episodeId,
        username,
        content,
        avatarUrl: randomAvatar(username),
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

router.post("/comments/:id/like", async (req, res) => {
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

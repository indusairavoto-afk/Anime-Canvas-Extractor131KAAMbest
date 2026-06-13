import { Router } from "express";
import { db } from "@workspace/db";
import { communityPostTable, commentTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { toCommentResponse } from "./comments";

const router = Router();

function randomAvatar(username: string) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`;
}

function toPostResponse(row: typeof communityPostTable.$inferSelect) {
  return {
    id: row.id,
    username: row.username,
    avatarUrl: row.avatarUrl,
    title: row.title,
    content: row.content,
    category: row.category,
    imageUrl: row.imageUrl,
    likes: row.likes,
    commentCount: row.commentCount,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/community", async (req, res) => {
  try {
    const { category, limit = "20", offset = "0" } = req.query as Record<string, string>;

    const rows = category
      ? await db.select().from(communityPostTable)
          .where(eq(communityPostTable.category, category))
          .orderBy(desc(communityPostTable.createdAt))
          .limit(parseInt(limit))
          .offset(parseInt(offset))
      : await db.select().from(communityPostTable)
          .orderBy(desc(communityPostTable.createdAt))
          .limit(parseInt(limit))
          .offset(parseInt(offset));

    res.json(rows.map(toPostResponse));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/community", async (req, res) => {
  try {
    const { username, title, content, category, imageUrl } = req.body;
    const [row] = await db
      .insert(communityPostTable)
      .values({
        username,
        title,
        content,
        category,
        imageUrl: imageUrl ?? null,
        avatarUrl: randomAvatar(username),
        likes: 0,
        commentCount: 0,
      })
      .returning();
    res.status(201).json(toPostResponse(row));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/community/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.select().from(communityPostTable).where(eq(communityPostTable.id, id));
    if (!row) { res.status(404).json({ error: "Post not found" }); return; }
    res.json(toPostResponse(row));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/community/:id/comments", async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const rows = await db
      .select()
      .from(commentTable)
      .where(eq(commentTable.communityPostId, postId))
      .orderBy(commentTable.createdAt);
    res.json(rows.map(toCommentResponse));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/community/:id/comments", async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const { username, content, parentId } = req.body;

    const [row] = await db
      .insert(commentTable)
      .values({
        communityPostId: postId,
        username,
        content,
        avatarUrl: randomAvatar(username),
        parentId: parentId ?? null,
        likes: 0,
      })
      .returning();

    await db
      .update(communityPostTable)
      .set({ commentCount: sql`${communityPostTable.commentCount} + 1` })
      .where(eq(communityPostTable.id, postId));

    res.status(201).json(toCommentResponse(row));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

import { Router } from "express";
import { db } from "@workspace/db";
import { userTable, reviewTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { desc } from "drizzle-orm";

const router = Router();

function toPublicUser(row: typeof userTable.$inferSelect) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    email: row.email,
    bio: row.bio ?? null,
    avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(row.avatarSeed)}`,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/users/:username", async (req, res) => {
  try {
    const [row] = await db.select().from(userTable)
      .where(eq(userTable.username, req.params.username.toLowerCase()))
      .limit(1);
    if (!row) { res.status(404).json({ error: "User not found" }); return; }
    const reviewCount = await db.select().from(reviewTable)
      .where(eq(reviewTable.username, row.username));
    res.json({ ...toPublicUser(row), reviewCount: reviewCount.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/users/:username/reviews", async (req, res) => {
  try {
    const [user] = await db.select().from(userTable)
      .where(eq(userTable.username, req.params.username.toLowerCase()))
      .limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    const rows = await db.select().from(reviewTable)
      .where(eq(reviewTable.username, user.username))
      .orderBy(desc(reviewTable.createdAt));
    res.json(rows.map(r => ({
      id: r.id,
      animeId: r.animeId,
      username: r.username,
      avatarUrl: r.avatarUrl,
      rating: r.rating,
      content: r.content,
      spoiler: r.spoiler,
      likes: r.likes,
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

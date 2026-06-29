import { Router } from "express";
import { db } from "@workspace/db";
import { userTable, reviewTable, followsTable, animeTable } from "@workspace/db/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";

const router = Router();

function toPublicUser(row: typeof userTable.$inferSelect) {
  let avatarUrl: string;
  if (row.avatarSeed.startsWith("lorelei:")) {
    const seed = row.avatarSeed.slice("lorelei:".length);
    avatarUrl = `https://api.dicebear.com/9.x/lorelei/svg?seed=${encodeURIComponent(seed)}&backgroundColor=transparent`;
  } else {
    avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(row.avatarSeed)}`;
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl,
    bio: row.bio ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/users/:username", async (req, res) => {
  try {
    const uname = req.params.username.toLowerCase();
    const viewer = typeof req.query.viewer === "string" ? req.query.viewer.toLowerCase() : null;

    const [row] = await db.select().from(userTable).where(eq(userTable.username, uname)).limit(1);
    if (!row) { res.status(404).json({ error: "User not found" }); return; }

    const [followerCountRes, followingCountRes, reviewCountRes] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.followingId, row.id)),
      db.select({ count: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.followerId, row.id)),
      db.select({ count: sql<number>`count(*)::int` }).from(reviewTable).where(eq(reviewTable.username, row.username)),
    ]);

    let isFollowing = false;
    if (viewer) {
      const [viewerRow] = await db.select().from(userTable).where(eq(userTable.username, viewer)).limit(1);
      if (viewerRow) {
        const [rel] = await db.select().from(followsTable)
          .where(and(eq(followsTable.followerId, viewerRow.id), eq(followsTable.followingId, row.id)))
          .limit(1);
        isFollowing = !!rel;
      }
    }

    res.json({
      ...toPublicUser(row),
      email: row.email,
      reviewCount: reviewCountRes[0]?.count ?? 0,
      followerCount: followerCountRes[0]?.count ?? 0,
      followingCount: followingCountRes[0]?.count ?? 0,
      isFollowing,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/users/:username", async (req, res) => {
  try {
    const { displayName, bio } = req.body;
    const username = req.params.username.toLowerCase();

    const [row] = await db.select().from(userTable).where(eq(userTable.username, username)).limit(1);
    if (!row) { res.status(404).json({ error: "User not found" }); return; }

    const updates: Partial<typeof userTable.$inferInsert> = {};
    if (typeof displayName === "string") {
      const trimmed = displayName.trim();
      if (!trimmed) { res.status(400).json({ error: "Display name cannot be empty" }); return; }
      updates.displayName = trimmed;
    }
    if (typeof bio === "string") updates.bio = bio.trim() || null;

    const [updated] = await db.update(userTable).set(updates).where(eq(userTable.username, username)).returning();

    const [reviewCountRes] = await db.select({ count: sql<number>`count(*)::int` })
      .from(reviewTable).where(eq(reviewTable.username, updated.username));

    res.json({ ...toPublicUser(updated), email: updated.email, reviewCount: reviewCountRes?.count ?? 0 });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/users/:username/reviews", async (req, res) => {
  try {
    const [user] = await db.select().from(userTable)
      .where(eq(userTable.username, req.params.username.toLowerCase())).limit(1);
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

router.post("/users/:username/follow", async (req, res) => {
  try {
    const targetUsername = req.params.username.toLowerCase();
    const { followerUsername } = req.body as { followerUsername?: string };
    if (!followerUsername) { res.status(400).json({ error: "followerUsername required" }); return; }

    const [target] = await db.select().from(userTable).where(eq(userTable.username, targetUsername)).limit(1);
    if (!target) { res.status(404).json({ error: "User not found" }); return; }

    const [follower] = await db.select().from(userTable)
      .where(eq(userTable.username, followerUsername.toLowerCase())).limit(1);
    if (!follower) { res.status(404).json({ error: "Follower not found" }); return; }

    if (follower.id === target.id) { res.status(400).json({ error: "Cannot follow yourself" }); return; }

    await db.insert(followsTable)
      .values({ followerId: follower.id, followingId: target.id })
      .onConflictDoNothing();

    const [countRes] = await db.select({ count: sql<number>`count(*)::int` })
      .from(followsTable).where(eq(followsTable.followingId, target.id));
    res.json({ isFollowing: true, followerCount: countRes?.count ?? 0 });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/users/:username/follow", async (req, res) => {
  try {
    const targetUsername = req.params.username.toLowerCase();
    const { followerUsername } = req.body as { followerUsername?: string };
    if (!followerUsername) { res.status(400).json({ error: "followerUsername required" }); return; }

    const [target] = await db.select().from(userTable).where(eq(userTable.username, targetUsername)).limit(1);
    if (!target) { res.status(404).json({ error: "User not found" }); return; }

    const [follower] = await db.select().from(userTable)
      .where(eq(userTable.username, followerUsername.toLowerCase())).limit(1);
    if (!follower) { res.status(404).json({ error: "Follower not found" }); return; }

    await db.delete(followsTable)
      .where(and(eq(followsTable.followerId, follower.id), eq(followsTable.followingId, target.id)));

    const [countRes] = await db.select({ count: sql<number>`count(*)::int` })
      .from(followsTable).where(eq(followsTable.followingId, target.id));
    res.json({ isFollowing: false, followerCount: countRes?.count ?? 0 });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/users/:username/followers", async (req, res) => {
  try {
    const [target] = await db.select().from(userTable)
      .where(eq(userTable.username, req.params.username.toLowerCase())).limit(1);
    if (!target) { res.status(404).json({ error: "User not found" }); return; }

    const rows = await db
      .select({ user: userTable })
      .from(followsTable)
      .innerJoin(userTable, eq(followsTable.followerId, userTable.id))
      .where(eq(followsTable.followingId, target.id))
      .orderBy(desc(followsTable.createdAt));

    res.json(rows.map(r => toPublicUser(r.user)));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/users/:username/following", async (req, res) => {
  try {
    const [target] = await db.select().from(userTable)
      .where(eq(userTable.username, req.params.username.toLowerCase())).limit(1);
    if (!target) { res.status(404).json({ error: "User not found" }); return; }

    const rows = await db
      .select({ user: userTable })
      .from(followsTable)
      .innerJoin(userTable, eq(followsTable.followingId, userTable.id))
      .where(eq(followsTable.followerId, target.id))
      .orderBy(desc(followsTable.createdAt));

    res.json(rows.map(r => toPublicUser(r.user)));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

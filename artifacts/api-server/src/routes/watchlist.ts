import { Router } from "express";
import { db } from "@workspace/db";
import { watchlistTable, mangaListTable, userTable, mangaReadStatusEnum } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

const router = Router();

async function resolveUserId(username: string): Promise<number | null> {
  const [row] = await db.select({ id: userTable.id })
    .from(userTable).where(eq(userTable.username, username.toLowerCase())).limit(1);
  return row?.id ?? null;
}

/* ─── Anime watchlist ───────────────────────────────────────────────────── */

router.get("/watchlist", async (req, res) => {
  try {
    const username = req.query.username as string;
    if (!username) { res.status(400).json({ error: "username required" }); return; }
    const userId = await resolveUserId(username);
    if (!userId) { res.status(404).json({ error: "User not found" }); return; }
    const rows = await db.select({ animeId: watchlistTable.animeId, addedAt: watchlistTable.addedAt })
      .from(watchlistTable).where(eq(watchlistTable.userId, userId));
    res.json(rows.map(r => ({ animeId: r.animeId, addedAt: r.addedAt.toISOString() })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/watchlist", async (req, res) => {
  try {
    const { username, animeId } = req.body;
    if (!username || !animeId) { res.status(400).json({ error: "username and animeId required" }); return; }
    const userId = await resolveUserId(username);
    if (!userId) { res.status(404).json({ error: "User not found" }); return; }
    await db.insert(watchlistTable).values({ userId, animeId: Number(animeId) }).onConflictDoNothing();
    res.status(201).json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/watchlist/:animeId", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) { res.status(400).json({ error: "username required" }); return; }
    const userId = await resolveUserId(username);
    if (!userId) { res.status(404).json({ error: "User not found" }); return; }
    await db.delete(watchlistTable).where(
      and(eq(watchlistTable.userId, userId), eq(watchlistTable.animeId, Number(req.params.animeId)))
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Manga list ────────────────────────────────────────────────────────── */

const VALID_STATUSES = new Set(["reading", "plan_to_read", "completed"]);

router.get("/mangalist", async (req, res) => {
  try {
    const username = req.query.username as string;
    if (!username) { res.status(400).json({ error: "username required" }); return; }
    const userId = await resolveUserId(username);
    if (!userId) { res.status(404).json({ error: "User not found" }); return; }
    const rows = await db.select().from(mangaListTable).where(eq(mangaListTable.userId, userId));
    res.json(rows.map(r => ({
      id: r.mangaId,
      status: r.status,
      chapter: r.chapter,
      addedAt: r.addedAt.getTime(),
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/mangalist", async (req, res) => {
  try {
    const { username, mangaId, status = "plan_to_read", chapter = 0 } = req.body;
    if (!username || !mangaId) { res.status(400).json({ error: "username and mangaId required" }); return; }
    if (!VALID_STATUSES.has(status)) { res.status(400).json({ error: "Invalid status" }); return; }
    const userId = await resolveUserId(username);
    if (!userId) { res.status(404).json({ error: "User not found" }); return; }
    await db.insert(mangaListTable)
      .values({ userId, mangaId: Number(mangaId), status, chapter: Number(chapter) })
      .onConflictDoUpdate({
        target: [mangaListTable.userId, mangaListTable.mangaId],
        set: { status, chapter: Number(chapter) },
      });
    res.status(201).json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/mangalist/:mangaId", async (req, res) => {
  try {
    const { username, status, chapter } = req.body;
    if (!username) { res.status(400).json({ error: "username required" }); return; }
    if (status && !VALID_STATUSES.has(status)) { res.status(400).json({ error: "Invalid status" }); return; }
    const userId = await resolveUserId(username);
    if (!userId) { res.status(404).json({ error: "User not found" }); return; }
    const updates: Partial<{ status: typeof mangaReadStatusEnum.enumValues[number]; chapter: number }> = {};
    if (status) updates.status = status;
    if (chapter !== undefined) updates.chapter = Math.max(0, Number(chapter));
    await db.update(mangaListTable).set(updates).where(
      and(eq(mangaListTable.userId, userId), eq(mangaListTable.mangaId, Number(req.params.mangaId)))
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/mangalist/:mangaId", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) { res.status(400).json({ error: "username required" }); return; }
    const userId = await resolveUserId(username);
    if (!userId) { res.status(404).json({ error: "User not found" }); return; }
    await db.delete(mangaListTable).where(
      and(eq(mangaListTable.userId, userId), eq(mangaListTable.mangaId, Number(req.params.mangaId)))
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

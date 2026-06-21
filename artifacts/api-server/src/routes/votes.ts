import { Router, type IRouter } from "express";
import { db, episodeVoteTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

const router: IRouter = Router();

type VoteCategory = "skip" | "timepass" | "go_for_it" | "perfection";
const VALID: VoteCategory[] = ["skip", "timepass", "go_for_it", "perfection"];

async function getCounts(animeId: string, episode: number) {
  const rows = await db
    .select({ category: episodeVoteTable.category, count: sql<number>`cast(count(*) as int)` })
    .from(episodeVoteTable)
    .where(and(eq(episodeVoteTable.animeId, animeId), eq(episodeVoteTable.episode, episode)))
    .groupBy(episodeVoteTable.category);

  const result: Record<VoteCategory, number> = { skip: 0, timepass: 0, go_for_it: 0, perfection: 0 };
  for (const row of rows) result[row.category as VoteCategory] = row.count;
  return result;
}

router.get("/votes/:animeId/:episode", async (req, res) => {
  try {
    const counts = await getCounts(req.params.animeId, Number(req.params.episode));
    res.json(counts);
  } catch {
    res.json({ skip: 0, timepass: 0, go_for_it: 0, perfection: 0 });
  }
});

router.post("/votes/:animeId/:episode", async (req, res) => {
  const { animeId, episode } = req.params;
  const { category, voterKey } = req.body as { category?: unknown; voterKey?: unknown };

  if (!category || !VALID.includes(category as VoteCategory)) {
    res.status(400).json({ error: "Invalid category" });
    return;
  }
  if (!voterKey || typeof voterKey !== "string") {
    res.status(400).json({ error: "voterKey required" });
    return;
  }

  try {
    await db
      .insert(episodeVoteTable)
      .values({
        animeId,
        episode: Number(episode),
        category: category as VoteCategory,
        voterKey,
      })
      .onConflictDoUpdate({
        target: [episodeVoteTable.animeId, episodeVoteTable.episode, episodeVoteTable.voterKey],
        set: { category: category as VoteCategory },
      });

    const counts = await getCounts(animeId, Number(episode));
    res.json(counts);
  } catch (err) {
    console.error("Vote error:", err);
    res.status(500).json({ error: "Failed to save vote" });
  }
});

export default router;

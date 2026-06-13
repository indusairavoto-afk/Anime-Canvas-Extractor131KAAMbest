import { Router } from "express";
import { db } from "@workspace/db";
import { animeTable, episodeTable, commentTable, communityPostTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { toAnimeResponse, toEpisodeResponse } from "./anime";

const router = Router();

router.get("/discovery/trending", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(animeTable)
      .where(eq(animeTable.isTrending, true))
      .orderBy(desc(animeTable.viewCount))
      .limit(12);
    res.json(rows.map(toAnimeResponse));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/discovery/featured", async (req, res) => {
  try {
    const [anime] = await db
      .select()
      .from(animeTable)
      .where(eq(animeTable.isFeatured, true))
      .limit(1);
    if (!anime) { res.status(404).json({ error: "No featured anime" }); return; }

    const [latestEpisode] = await db
      .select()
      .from(episodeTable)
      .where(eq(episodeTable.animeId, anime.id))
      .orderBy(desc(episodeTable.episodeNumber))
      .limit(1);

    res.json({
      anime: toAnimeResponse(anime),
      latestEpisode: latestEpisode
        ? toEpisodeResponse(latestEpisode, anime.title, anime.coverImage)
        : null,
      highlightText: `${anime.studio} — ${anime.releaseYear}`,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/discovery/new-releases", async (req, res) => {
  try {
    const rows = await db
      .select({
        ep: episodeTable,
        anime: animeTable,
      })
      .from(episodeTable)
      .innerJoin(animeTable, eq(episodeTable.animeId, animeTable.id))
      .orderBy(desc(episodeTable.createdAt))
      .limit(12);

    res.json(rows.map(({ ep, anime }) => toEpisodeResponse(ep, anime.title, anime.coverImage)));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/discovery/genres", async (req, res) => {
  try {
    const allAnime = await db.select({ genre: animeTable.genre }).from(animeTable);
    const counts: Record<string, number> = {};
    for (const { genre } of allAnime) {
      for (const g of genre ?? []) {
        counts[g] = (counts[g] ?? 0) + 1;
      }
    }
    const result = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([genre, count]) => ({ genre, count }));
    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/discovery/stats", async (req, res) => {
  try {
    const [[animeCount], [episodeCount], [postCount], [commentCount]] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(animeTable),
      db.select({ count: sql<number>`count(*)` }).from(episodeTable),
      db.select({ count: sql<number>`count(*)` }).from(communityPostTable),
      db.select({ count: sql<number>`count(*)` }).from(commentTable),
    ]);
    res.json({
      totalAnime: Number(animeCount?.count ?? 0),
      totalEpisodes: Number(episodeCount?.count ?? 0),
      totalCommunityPosts: Number(postCount?.count ?? 0),
      totalComments: Number(commentCount?.count ?? 0),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

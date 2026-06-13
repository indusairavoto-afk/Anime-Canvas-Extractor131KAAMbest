import { Router } from "express";
import { db } from "@workspace/db";
import { animeTable, episodeTable } from "@workspace/db";
import { eq, ilike, arrayContains, and, desc } from "drizzle-orm";

const router = Router();

router.get("/anime", async (req, res) => {
  try {
    const { genre, status, search, limit = "20", offset = "0" } = req.query as Record<string, string>;
    const conditions = [];

    if (genre) conditions.push(arrayContains(animeTable.genre, [genre]));
    if (status) conditions.push(eq(animeTable.status, status as "ongoing" | "completed" | "upcoming"));
    if (search) conditions.push(ilike(animeTable.title, `%${search}%`));

    const rows = await db
      .select()
      .from(animeTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(animeTable.viewCount))
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    res.json(rows.map(toAnimeResponse));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/anime/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.select().from(animeTable).where(eq(animeTable.id, id));
    if (!row) { res.status(404).json({ error: "Anime not found" }); return; }
    res.json(toAnimeResponse(row));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/anime/:id/episodes", async (req, res) => {
  try {
    const animeId = parseInt(req.params.id);
    const [anime] = await db.select().from(animeTable).where(eq(animeTable.id, animeId));
    const episodes = await db
      .select()
      .from(episodeTable)
      .where(eq(episodeTable.animeId, animeId))
      .orderBy(episodeTable.episodeNumber);

    res.json(episodes.map((ep) => toEpisodeResponse(ep, anime?.title ?? "", anime?.coverImage ?? null)));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/episodes/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [ep] = await db.select().from(episodeTable).where(eq(episodeTable.id, id));
    if (!ep) { res.status(404).json({ error: "Episode not found" }); return; }
    const [anime] = await db.select().from(animeTable).where(eq(animeTable.id, ep.animeId));
    res.json(toEpisodeResponse(ep, anime?.title ?? "", anime?.coverImage ?? null));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export function toAnimeResponse(row: typeof animeTable.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    japaneseTitle: row.japaneseTitle,
    description: row.description,
    coverImage: row.coverImage,
    bannerImage: row.bannerImage,
    trailerUrl: row.trailerUrl,
    genre: row.genre ?? [],
    status: row.status,
    rating: row.rating,
    totalEpisodes: row.totalEpisodes,
    releaseYear: row.releaseYear,
    studio: row.studio,
    type: row.type,
    viewCount: row.viewCount,
    isTrending: row.isTrending,
    isFeatured: row.isFeatured,
  };
}

export function toEpisodeResponse(
  ep: typeof episodeTable.$inferSelect,
  animeTitle: string,
  animeCover: string | null
) {
  return {
    id: ep.id,
    animeId: ep.animeId,
    animeTitle,
    animeCover,
    title: ep.title,
    season: ep.season,
    episodeNumber: ep.episodeNumber,
    duration: ep.duration,
    description: ep.description,
    thumbnailUrl: ep.thumbnailUrl,
    streamUrl: ep.streamUrl,
    releaseDate: ep.releaseDate,
    viewCount: ep.viewCount,
    type: ep.type,
    rating: null,
  };
}

export default router;

import { db } from "@workspace/db";
import { animeTable, anilistSyncLogTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

const ANILIST_URL = "https://graphql.anilist.co";

const MEDIA_FIELDS = `
  id
  title { romaji english native }
  description(asHtml: false)
  coverImage { extraLarge large }
  bannerImage
  genres
  averageScore
  episodes
  seasonYear
  startDate { year }
  status
  type
  trending
  popularity
  trailer { id site }
  studios(isMain: true) { nodes { name } }
`;

const QUERIES = {
  trending: `
    query {
      Page(page: 1, perPage: 50) {
        media(sort: TRENDING_DESC, type: ANIME, isAdult: false) { ${MEDIA_FIELDS} }
      }
    }
  `,
  popular: `
    query {
      Page(page: 1, perPage: 50) {
        media(sort: POPULARITY_DESC, type: ANIME, isAdult: false) { ${MEDIA_FIELDS} }
      }
    }
  `,
  topRated: `
    query {
      Page(page: 1, perPage: 50) {
        media(sort: SCORE_DESC, type: ANIME, isAdult: false, averageScore_greater: 70) { ${MEDIA_FIELDS} }
      }
    }
  `,
  seasonal: `
    query {
      Page(page: 1, perPage: 50) {
        media(sort: POPULARITY_DESC, type: ANIME, isAdult: false, status: RELEASING) { ${MEDIA_FIELDS} }
      }
    }
  `,
};

interface AnilistMedia {
  id: number;
  title: { romaji: string | null; english: string | null; native: string | null };
  description: string | null;
  coverImage: { extraLarge: string | null; large: string | null };
  bannerImage: string | null;
  genres: string[];
  averageScore: number | null;
  episodes: number | null;
  seasonYear: number | null;
  startDate: { year: number | null } | null;
  status: "FINISHED" | "RELEASING" | "NOT_YET_RELEASED" | "CANCELLED" | "HIATUS";
  type: string;
  trending: number | null;
  popularity: number | null;
  trailer: { id: string; site: string } | null;
  studios: { nodes: { name: string }[] };
}

function stripHtml(html: string | null): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim();
}

function mapStatus(s: AnilistMedia["status"]): "ongoing" | "completed" | "upcoming" {
  if (s === "RELEASING") return "ongoing";
  if (s === "FINISHED") return "completed";
  return "upcoming";
}

function mapTrailerUrl(trailer: AnilistMedia["trailer"] | null): string | null {
  if (!trailer) return null;
  if (trailer.site === "youtube") return `https://www.youtube.com/watch?v=${trailer.id}`;
  if (trailer.site === "dailymotion") return `https://www.dailymotion.com/video/${trailer.id}`;
  return null;
}

function toAnimeRow(media: AnilistMedia, trendingIds: Set<number>, featuredId: number | null) {
  const title = media.title.english || media.title.romaji || "Unknown";
  const cover = media.coverImage.extraLarge || media.coverImage.large || "";
  const banner = media.bannerImage || cover;
  const desc = stripHtml(media.description) || "No description available.";
  const studio = media.studios.nodes[0]?.name || "Unknown Studio";
  const year = media.seasonYear || media.startDate?.year || new Date().getFullYear();
  const rating = media.averageScore ? media.averageScore / 10 : 0;

  return {
    anilistId: media.id,
    title,
    japaneseTitle: media.title.native || null,
    description: desc,
    coverImage: cover,
    bannerImage: banner,
    trailerUrl: mapTrailerUrl(media.trailer),
    genre: media.genres ?? [],
    status: mapStatus(media.status),
    rating,
    totalEpisodes: media.episodes ?? 0,
    releaseYear: year,
    studio,
    type: "sub" as const,
    isTrending: trendingIds.has(media.id),
    isFeatured: media.id === featuredId,
    updatedAt: new Date(),
  };
}

async function fetchAnilist(query: string): Promise<AnilistMedia[]> {
  const res = await fetch(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
  const json = await res.json() as { data?: { Page?: { media?: AnilistMedia[] } }; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join(", "));
  return json.data?.Page?.media ?? [];
}

let syncRunning = false;

export async function runAnilistSync(): Promise<{ upserted: number; errors: number; message: string }> {
  if (syncRunning) {
    return { upserted: 0, errors: 0, message: "Sync already in progress" };
  }
  syncRunning = true;

  const [logRow] = await db.insert(anilistSyncLogTable).values({ status: "running" }).returning();
  const logId = logRow.id;

  let upserted = 0;
  let errors = 0;
  const seen = new Map<number, AnilistMedia>();

  try {
    logger.info("AniList sync: fetching data…");

    const [trendingList, popularList, topRatedList, seasonalList] = await Promise.all([
      fetchAnilist(QUERIES.trending).catch(e => { logger.warn(e, "trending fetch failed"); return [] as AnilistMedia[]; }),
      fetchAnilist(QUERIES.popular).catch(e => { logger.warn(e, "popular fetch failed"); return [] as AnilistMedia[]; }),
      fetchAnilist(QUERIES.topRated).catch(e => { logger.warn(e, "top-rated fetch failed"); return [] as AnilistMedia[]; }),
      fetchAnilist(QUERIES.seasonal).catch(e => { logger.warn(e, "seasonal fetch failed"); return [] as AnilistMedia[]; }),
    ]);

    const trendingIds = new Set(trendingList.map(m => m.id));
    const featuredId = trendingList[0]?.id ?? null;

    for (const list of [trendingList, popularList, topRatedList, seasonalList]) {
      for (const media of list) {
        if (!media.id) continue;
        if (!seen.has(media.id)) seen.set(media.id, media);
      }
    }

    logger.info({ total: seen.size }, "AniList sync: upserting anime…");

    for (const media of seen.values()) {
      try {
        const row = toAnimeRow(media, trendingIds, featuredId);
        await db
          .insert(animeTable)
          .values({ ...row, viewCount: 0 })
          .onConflictDoUpdate({
            target: animeTable.anilistId,
            set: {
              title: sql`excluded.title`,
              japaneseTitle: sql`excluded.japanese_title`,
              description: sql`excluded.description`,
              coverImage: sql`excluded.cover_image`,
              bannerImage: sql`excluded.banner_image`,
              trailerUrl: sql`excluded.trailer_url`,
              genre: sql`excluded.genre`,
              status: sql`excluded.status`,
              rating: sql`excluded.rating`,
              totalEpisodes: sql`excluded.total_episodes`,
              releaseYear: sql`excluded.release_year`,
              studio: sql`excluded.studio`,
              isTrending: sql`excluded.is_trending`,
              isFeatured: sql`excluded.is_featured`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
        upserted++;
      } catch (err) {
        logger.warn({ err, anilistId: media.id }, "AniList sync: upsert failed for entry");
        errors++;
      }
    }

    const message = `Synced ${upserted} anime from AniList (${errors} errors)`;
    logger.info(message);

    await db
      .update(anilistSyncLogTable)
      .set({ status: "success", finishedAt: new Date(), upserted, errors, message })
      .where(eq(anilistSyncLogTable.id, logId));

    return { upserted, errors, message };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "AniList sync failed");
    await db
      .update(anilistSyncLogTable)
      .set({ status: "error", finishedAt: new Date(), upserted, errors, message })
      .where(eq(anilistSyncLogTable.id, logId));
    return { upserted, errors, message: `Sync failed: ${message}` };
  } finally {
    syncRunning = false;
  }
}

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function startAutoSync() {
  const runAndSchedule = async () => {
    try {
      const count = await db.select({ c: sql<number>`count(*)` }).from(animeTable);
      const total = Number(count[0]?.c ?? 0);
      if (total === 0) {
        logger.info("AniList auto-sync: DB empty, running initial sync…");
        await runAnilistSync();
      } else {
        logger.info({ total }, "AniList auto-sync: DB already has anime, skipping initial sync");
      }
    } catch (err) {
      logger.warn({ err }, "AniList auto-sync: initial check failed");
    }
  };

  runAndSchedule();
  setInterval(() => {
    logger.info("AniList auto-sync: scheduled run starting…");
    runAnilistSync().catch(err => logger.error({ err }, "AniList scheduled sync error"));
  }, SYNC_INTERVAL_MS);
}

import { Router, type IRouter } from "express";
import { db, streamReportTable } from "@workspace/db";
import { desc, eq, and, sql } from "drizzle-orm";

const router: IRouter = Router();

router.post("/report-stream", async (req, res) => {
  const { animeId, animeTitle, episode, server, lang, gogoSlug, anizoneSlug, kotoSlug, miruroUrl } =
    req.body as {
      animeId?: number;
      animeTitle?: string;
      episode?: number;
      server?: string;
      lang?: string;
      gogoSlug?: string;
      anizoneSlug?: string;
      kotoSlug?: string;
      miruroUrl?: string;
    };

  if (!animeId || !animeTitle || !episode || !server) {
    return res.status(400).json({ error: "animeId, animeTitle, episode, and server are required" });
  }

  try {
    await db.insert(streamReportTable).values({
      animeId,
      animeTitle,
      episode,
      server,
      lang: lang ?? "SUB",
      gogoSlug: gogoSlug ?? null,
      anizoneSlug: anizoneSlug ?? null,
      kotoSlug: kotoSlug ?? null,
      miruroUrl: miruroUrl ?? null,
    });

    return res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: msg });
  }
});

router.get("/report-stream", async (req, res) => {
  try {
    const rows = await db
      .select({
        animeId: streamReportTable.animeId,
        animeTitle: streamReportTable.animeTitle,
        episode: streamReportTable.episode,
        server: streamReportTable.server,
        lang: streamReportTable.lang,
        count: sql<number>`cast(count(*) as int)`,
        latest: sql<string>`max(${streamReportTable.reportedAt})`,
      })
      .from(streamReportTable)
      .groupBy(
        streamReportTable.animeId,
        streamReportTable.animeTitle,
        streamReportTable.episode,
        streamReportTable.server,
        streamReportTable.lang,
      )
      .orderBy(desc(sql`max(${streamReportTable.reportedAt})`))
      .limit(100);

    return res.json({ reports: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: msg });
  }
});

export default router;

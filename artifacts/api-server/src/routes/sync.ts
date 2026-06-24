import { Router } from "express";
import { db } from "@workspace/db";
import { anilistSyncLogTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { runAnilistSync } from "../lib/anilist-sync";

const router = Router();

router.post("/admin/sync/anilist", async (req, res) => {
  try {
    const result = await runAnilistSync();
    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sync failed" });
  }
});

router.get("/admin/sync/status", async (req, res) => {
  try {
    const logs = await db
      .select()
      .from(anilistSyncLogTable)
      .orderBy(desc(anilistSyncLogTable.startedAt))
      .limit(10);
    res.json(logs);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

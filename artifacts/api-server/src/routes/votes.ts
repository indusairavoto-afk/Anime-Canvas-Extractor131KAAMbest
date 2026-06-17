import { Router, type IRouter } from "express";

const router: IRouter = Router();

type VoteCategory = "skip" | "okay" | "watch" | "masterpiece";
const VALID: VoteCategory[] = ["skip", "okay", "watch", "masterpiece"];

interface Counts { skip: number; okay: number; watch: number; masterpiece: number; }

const store = new Map<string, Counts>();

function key(animeId: string, episode: string) {
  return `${animeId}:${episode}`;
}

function get(animeId: string, episode: string): Counts {
  return store.get(key(animeId, episode)) ?? { skip: 0, okay: 0, watch: 0, masterpiece: 0 };
}

router.get("/votes/:animeId/:episode", (req, res) => {
  res.json(get(req.params.animeId, req.params.episode));
});

router.post("/votes/:animeId/:episode", (req, res) => {
  const { animeId, episode } = req.params;
  const { category, previousVote } = req.body as { category?: unknown; previousVote?: unknown };

  if (!category || !VALID.includes(category as VoteCategory)) {
    res.status(400).json({ error: "Invalid category" });
    return;
  }

  const k = key(animeId, episode);
  const counts = get(animeId, episode);

  if (previousVote && VALID.includes(previousVote as VoteCategory)) {
    counts[previousVote as VoteCategory] = Math.max(0, counts[previousVote as VoteCategory] - 1);
  }
  counts[category as VoteCategory] += 1;

  store.set(k, counts);
  res.json(counts);
});

export default router;

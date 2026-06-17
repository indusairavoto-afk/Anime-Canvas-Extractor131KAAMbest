import { Router, type IRouter } from "express";

const router: IRouter = Router();

const SESSION_TTL_MS = 60_000;

const rooms = new Map<string, Map<string, number>>();

function roomKey(animeId: string | number, episode: string | number) {
  return `${animeId}:${episode}`;
}

function cleanRoom(room: Map<string, number>) {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [sid, ts] of room) {
    if (ts < cutoff) room.delete(sid);
  }
}

function getCount(animeId: string | number, episode: string | number): number {
  const key = roomKey(animeId, episode);
  const room = rooms.get(key);
  if (!room) return 0;
  cleanRoom(room);
  return room.size;
}

router.post("/viewers/heartbeat", (req, res) => {
  const { animeId, episode, sessionId } = req.body as {
    animeId?: unknown;
    episode?: unknown;
    sessionId?: unknown;
  };
  if (!animeId || !episode || !sessionId) {
    res.status(400).json({ error: "Missing animeId, episode, or sessionId" });
    return;
  }
  const key = roomKey(String(animeId), String(episode));
  if (!rooms.has(key)) rooms.set(key, new Map());
  const room = rooms.get(key)!;
  cleanRoom(room);
  room.set(String(sessionId), Date.now());
  res.json({ count: room.size });
});

router.post("/viewers/leave", (req, res) => {
  const { animeId, episode, sessionId } = req.body as {
    animeId?: unknown;
    episode?: unknown;
    sessionId?: unknown;
  };
  if (!animeId || !episode || !sessionId) {
    res.status(400).json({ error: "Missing fields" });
    return;
  }
  const key = roomKey(String(animeId), String(episode));
  const room = rooms.get(key);
  if (room) {
    room.delete(String(sessionId));
    cleanRoom(room);
    if (room.size === 0) rooms.delete(key);
  }
  res.json({ count: room?.size ?? 0 });
});

router.get("/viewers/:animeId/:episode", (req, res) => {
  const { animeId, episode } = req.params;
  res.json({ count: getCount(animeId, episode) });
});

export default router;

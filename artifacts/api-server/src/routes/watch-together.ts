import { Router } from "express";
import { getRoomInfo } from "../watch-together";

const router = Router();

// GET /api/watch-together/:roomId — check if a room exists
router.get("/watch-together/:roomId", (req, res) => {
  const info = getRoomInfo(req.params.roomId);
  if (!info) {
    res.status(404).json({ error: "Room not found or empty" });
    return;
  }
  res.json(info);
});

export default router;

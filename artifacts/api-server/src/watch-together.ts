import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Server } from "http";
import { logger } from "./lib/logger";

// ── Types ──────────────────────────────────────────────────────────────────

interface Member {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  joinedAt: number;
}

interface RoomState {
  id: string;
  animeId: number;
  episode: number;
  playing: boolean;
  time: number;
  updatedAt: number;
  members: Map<string, Member>;
  sockets: Map<string, WebSocket>;
  hostId: string | null;
}

type ClientMsg =
  | { type: "join"; roomId: string; userId: string; name: string; color: string; animeId: number; episode: number }
  | { type: "play"; time: number }
  | { type: "pause"; time: number }
  | { type: "seek"; time: number }
  | { type: "sync"; time: number }
  | { type: "sync_request" }
  | { type: "chat"; text: string }
  | { type: "ping" };

// ── In-memory room store ───────────────────────────────────────────────────

const rooms = new Map<string, RoomState>();

function getOrCreateRoom(roomId: string, animeId: number, episode: number): RoomState {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      animeId,
      episode,
      playing: false,
      time: 0,
      updatedAt: Date.now(),
      members: new Map(),
      sockets: new Map(),
      hostId: null,
    });
  }
  return rooms.get(roomId)!;
}

function broadcast(room: RoomState, msg: object, exceptId?: string) {
  const payload = JSON.stringify(msg);
  room.sockets.forEach((ws, id) => {
    if (id === exceptId) return;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}

function broadcastAll(room: RoomState, msg: object) {
  broadcast(room, msg);
}

function memberList(room: RoomState): Member[] {
  return Array.from(room.members.values());
}

function removeUser(room: RoomState, userId: string) {
  room.members.delete(userId);
  room.sockets.delete(userId);

  // Reassign host if needed
  if (room.hostId === userId) {
    const next = room.members.keys().next().value;
    room.hostId = next ?? null;
    if (room.hostId) {
      const host = room.members.get(room.hostId);
      if (host) host.isHost = true;
    }
  }

  // Clean up empty rooms after 30s
  if (room.members.size === 0) {
    setTimeout(() => {
      if (rooms.get(room.id)?.members.size === 0) {
        rooms.delete(room.id);
      }
    }, 30_000);
  }
}

// ── WebSocket server setup ─────────────────────────────────────────────────

export function attachWatchTogether(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = req.url ?? "";
    if (!url.startsWith("/ws/watch-together")) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    let currentRoom: RoomState | null = null;
    let currentUserId: string | null = null;

    ws.on("message", (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(raw.toString()) as ClientMsg;
      } catch {
        return;
      }

      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      if (msg.type === "join") {
        const { roomId, userId, name, color, animeId, episode } = msg;
        currentRoom = getOrCreateRoom(roomId, animeId, episode);
        currentUserId = userId;

        const isFirstMember = currentRoom.members.size === 0;
        if (isFirstMember) currentRoom.hostId = userId;

        const member: Member = {
          id: userId,
          name,
          color,
          isHost: currentRoom.hostId === userId,
          joinedAt: Date.now(),
        };
        currentRoom.members.set(userId, member);
        currentRoom.sockets.set(userId, ws);

        // Send the new member the current room state
        ws.send(JSON.stringify({
          type: "state",
          members: memberList(currentRoom),
          hostId: currentRoom.hostId,
          playing: currentRoom.playing,
          time: currentRoom.time,
          episode: currentRoom.episode,
        }));

        // Notify others about the join
        broadcast(currentRoom, {
          type: "joined",
          member,
          members: memberList(currentRoom),
        }, userId);

        logger.info({ roomId, userId, name, size: currentRoom.members.size }, "watch-together join");
        return;
      }

      if (!currentRoom || !currentUserId) return;

      if (msg.type === "play") {
        currentRoom.playing = true;
        currentRoom.time = msg.time;
        currentRoom.updatedAt = Date.now();
        broadcastAll(currentRoom, { type: "play", from: currentUserId, time: msg.time });
        return;
      }

      if (msg.type === "pause") {
        currentRoom.playing = false;
        currentRoom.time = msg.time;
        currentRoom.updatedAt = Date.now();
        broadcastAll(currentRoom, { type: "pause", from: currentUserId, time: msg.time });
        return;
      }

      if (msg.type === "seek") {
        currentRoom.time = msg.time;
        currentRoom.updatedAt = Date.now();
        broadcastAll(currentRoom, { type: "seek", from: currentUserId, time: msg.time });
        return;
      }

      if (msg.type === "sync") {
        currentRoom.time = msg.time;
        currentRoom.updatedAt = Date.now();
        // Broadcast to ALL members including the sender so everyone seeks
        broadcastAll(currentRoom, { type: "sync", from: currentUserId, time: msg.time });
        return;
      }

      if (msg.type === "sync_request") {
        const member = currentRoom.members.get(currentUserId);
        if (!member || currentRoom.hostId === currentUserId) return; // host can't request from themselves
        // Send the request only to the host
        if (currentRoom.hostId) {
          const hostSocket = currentRoom.sockets.get(currentRoom.hostId);
          if (hostSocket?.readyState === WebSocket.OPEN) {
            hostSocket.send(JSON.stringify({
              type: "sync_requested",
              from: currentUserId,
              name: member.name,
              color: member.color,
            }));
          }
        }
        return;
      }

      if (msg.type === "chat") {
        const member = currentRoom.members.get(currentUserId);
        if (!member) return;
        broadcastAll(currentRoom, {
          type: "chat",
          from: currentUserId,
          name: member.name,
          color: member.color,
          text: msg.text.slice(0, 300),
          at: Date.now(),
        });
        return;
      }
    });

    ws.on("close", () => {
      if (!currentRoom || !currentUserId) return;
      removeUser(currentRoom, currentUserId);
      broadcastAll(currentRoom, {
        type: "left",
        userId: currentUserId,
        members: memberList(currentRoom),
        hostId: currentRoom.hostId,
      });
      logger.info({ roomId: currentRoom.id, userId: currentUserId }, "watch-together leave");
    });

    ws.on("error", (err) => {
      logger.warn({ err }, "watch-together ws error");
    });
  });

  logger.info("watch-together WebSocket attached");
}

// ── REST: create / info ───────────────────────────────────────────────────

export function getRoomInfo(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return {
    id: room.id,
    animeId: room.animeId,
    episode: room.episode,
    playing: room.playing,
    time: room.time,
    memberCount: room.members.size,
    members: memberList(room),
  };
}

export { rooms };

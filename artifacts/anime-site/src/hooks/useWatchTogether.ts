import { useState, useEffect, useRef, useCallback } from "react";

export interface WTMember {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  joinedAt: number;
}

export interface WTChatMsg {
  from: string;
  name: string;
  color: string;
  text: string;
  at: number;
}

export type WTStatus = "idle" | "connecting" | "connected" | "disconnected";

interface UseWatchTogetherOptions {
  animeId: number;
  episode: number;
  onPlay?: (time: number, fromSelf: boolean) => void;
  onPause?: (time: number, fromSelf: boolean) => void;
  onSeek?: (time: number, fromSelf: boolean) => void;
}

const COLORS = ["#f97316", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6", "#eab308", "#ef4444"];

function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function randomName() {
  const adjectives = ["Brave", "Quiet", "Swift", "Calm", "Bold", "Wise", "Sharp", "Cool"];
  const nouns = ["Otaku", "Watcher", "Viewer", "Fan", "Ninja", "Sage", "Hero", "Pilot"];
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
}

function generateRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function getOrCreateUser(): { id: string; name: string; color: string } {
  const stored = localStorage.getItem("wt_user");
  if (stored) {
    try { return JSON.parse(stored); } catch { /* ignore */ }
  }
  const user = { id: crypto.randomUUID(), name: randomName(), color: randomColor() };
  localStorage.setItem("wt_user", JSON.stringify(user));
  return user;
}

// Derive WebSocket URL from the Vite env API base
function getWsUrl(roomId: string) {
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
  let wsBase: string;
  if (apiBase) {
    // e.g. "http://localhost:8080" → "ws://localhost:8080"
    wsBase = apiBase.replace(/^http/, "ws").replace(/\/$/, "");
  } else {
    // Relative (same host) — use current page's host with correct protocol
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    wsBase = `${proto}//${window.location.host}`;
  }
  return `${wsBase}/ws/watch-together?room=${roomId}`;
}

export function useWatchTogether(opts: UseWatchTogetherOptions) {
  const { animeId, episode, onPlay, onPause, onSeek } = opts;

  const [status, setStatus] = useState<WTStatus>("idle");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [members, setMembers] = useState<WTMember[]>([]);
  const [chat, setChat] = useState<WTChatMsg[]>([]);
  const [hostId, setHostId] = useState<string | null>(null);
  const [joinNotice, setJoinNotice] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const userRef = useRef(getOrCreateUser());
  const roomIdRef = useRef<string | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connect = useCallback((rid: string) => {
    if (wsRef.current) wsRef.current.close();
    setStatus("connecting");
    roomIdRef.current = rid;
    setRoomId(rid);

    const ws = new WebSocket(getWsUrl(rid));
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      ws.send(JSON.stringify({
        type: "join",
        roomId: rid,
        userId: userRef.current.id,
        name: userRef.current.name,
        color: userRef.current.color,
        animeId,
        episode,
      }));
      // Keep-alive ping every 20s
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 20_000);
    };

    ws.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(event.data as string); } catch { return; }

      if (msg.type === "state") {
        setMembers((msg.members as WTMember[]) ?? []);
        setHostId(msg.hostId as string ?? null);
      } else if (msg.type === "joined") {
        setMembers((msg.members as WTMember[]) ?? []);
        const m = msg.member as WTMember;
        if (m.id !== userRef.current.id) {
          setJoinNotice(`${m.name} joined`);
          setTimeout(() => setJoinNotice(null), 3000);
        }
      } else if (msg.type === "left") {
        setMembers((msg.members as WTMember[]) ?? []);
      } else if (msg.type === "play") {
        onPlay?.(msg.time as number, msg.from === userRef.current.id);
      } else if (msg.type === "pause") {
        onPause?.(msg.time as number, msg.from === userRef.current.id);
      } else if (msg.type === "seek") {
        onSeek?.(msg.time as number, msg.from === userRef.current.id);
      } else if (msg.type === "chat") {
        setChat((prev) => [...prev.slice(-99), msg as unknown as WTChatMsg]);
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      if (pingRef.current) clearInterval(pingRef.current);
    };

    ws.onerror = () => {
      setStatus("disconnected");
    };
  }, [animeId, episode, onPlay, onPause, onSeek]);

  const createRoom = useCallback(() => {
    const rid = generateRoomId();
    connect(rid);
    return rid;
  }, [connect]);

  const joinRoom = useCallback((rid: string) => {
    connect(rid.toUpperCase().trim());
  }, [connect]);

  const leaveRoom = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("idle");
    setRoomId(null);
    setMembers([]);
    setChat([]);
    setHostId(null);
    roomIdRef.current = null;
  }, []);

  const sendPlay = useCallback((time: number) => {
    wsRef.current?.send(JSON.stringify({ type: "play", time }));
  }, []);

  const sendPause = useCallback((time: number) => {
    wsRef.current?.send(JSON.stringify({ type: "pause", time }));
  }, []);

  const sendSeek = useCallback((time: number) => {
    wsRef.current?.send(JSON.stringify({ type: "seek", time }));
  }, []);

  const sendChat = useCallback((text: string) => {
    wsRef.current?.send(JSON.stringify({ type: "chat", text }));
  }, []);

  const setUserName = useCallback((name: string) => {
    userRef.current = { ...userRef.current, name };
    localStorage.setItem("wt_user", JSON.stringify(userRef.current));
  }, []);

  // Auto-join from URL param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rid = params.get("room");
    if (rid && rid.length === 6) {
      connect(rid.toUpperCase());
    }
    return () => {
      wsRef.current?.close();
      if (pingRef.current) clearInterval(pingRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const user = userRef.current;
  const isHost = hostId === user.id;

  return {
    status,
    roomId,
    members,
    chat,
    hostId,
    isHost,
    user,
    joinNotice,
    createRoom,
    joinRoom,
    leaveRoom,
    sendPlay,
    sendPause,
    sendSeek,
    sendChat,
    setUserName,
  };
}

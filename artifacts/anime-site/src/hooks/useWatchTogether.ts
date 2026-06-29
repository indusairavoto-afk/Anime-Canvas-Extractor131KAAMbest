import { useState, useEffect, useRef, useCallback, useMemo } from "react";

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
  authUser?: { id: number; displayName: string; username: string } | null;
  onPlay?: (time: number, fromSelf: boolean) => void;
  onPause?: (time: number, fromSelf: boolean) => void;
  onSeek?: (time: number, fromSelf: boolean) => void;
  onSync?: (time: number, fromSelf: boolean) => void;
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

function colorForUsername(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function buildUser(authUser: { id: number; displayName: string; username: string }): { id: string; name: string; color: string } {
  return {
    id: String(authUser.id),
    name: authUser.displayName,
    color: colorForUsername(authUser.username),
  };
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
  const { animeId, episode, authUser, onPlay, onPause, onSeek, onSync } = opts;

  const isLoggedIn = !!authUser;

  const [status, setStatus] = useState<WTStatus>("idle");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [members, setMembers] = useState<WTMember[]>([]);
  const [chat, setChat] = useState<WTChatMsg[]>([]);
  const [hostId, setHostId] = useState<string | null>(null);
  const [joinNotice, setJoinNotice] = useState<{ name: string; color: string } | null>(null);
  const [leftNotice, setLeftNotice] = useState<{ name: string; color: string } | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [syncRequest, setSyncRequest] = useState<{ from: string; name: string; color: string } | null>(null);
  const [bufferingMembers, setBufferingMembers] = useState<Set<string>>(new Set());

  const wsRef = useRef<WebSocket | null>(null);
  const userRef = useRef(authUser ? buildUser(authUser) : { id: "", name: "", color: "" });
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
      // Clear any existing ping before creating a new one
      if (pingRef.current) clearInterval(pingRef.current);
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
        // Seek the player to the room's current time so joiners sync up immediately
        const roomTime = msg.time as number | undefined;
        if (typeof roomTime === "number" && roomTime > 0) {
          onSync?.(roomTime, false);
        }
      } else if (msg.type === "joined") {
        setMembers((msg.members as WTMember[]) ?? []);
        const m = msg.member as WTMember;
        if (m.id !== userRef.current.id) {
          setJoinNotice({ name: m.name, color: m.color });
          setTimeout(() => setJoinNotice(null), 3500);
        }
      } else if (msg.type === "left") {
        setMembers((msg.members as WTMember[]) ?? []);
        if (msg.hostId) setHostId(msg.hostId as string);
        // Show left notice for other members
        const leavingMember = members.find((m) => m.id === (msg.userId as string));
        if (leavingMember && leavingMember.id !== userRef.current.id) {
          setLeftNotice({ name: leavingMember.name, color: leavingMember.color });
          setTimeout(() => setLeftNotice(null), 3500);
        }
      } else if (msg.type === "play") {
        onPlay?.(msg.time as number, msg.from === userRef.current.id);
      } else if (msg.type === "pause") {
        onPause?.(msg.time as number, msg.from === userRef.current.id);
      } else if (msg.type === "seek") {
        onSeek?.(msg.time as number, msg.from === userRef.current.id);
      } else if (msg.type === "sync") {
        onSync?.(msg.time as number, msg.from === userRef.current.id);
        const senderName = (msg.from === userRef.current.id)
          ? "You synced everyone"
          : (() => {
              const m = wsRef.current; void m;
              return "Synced to host time";
            })();
        setSyncNotice(senderName);
        setTimeout(() => setSyncNotice(null), 2500);
      } else if (msg.type === "sync_requested") {
        setSyncRequest({ from: msg.from as string, name: msg.name as string, color: msg.color as string });
        setTimeout(() => setSyncRequest(null), 7000);
      } else if (msg.type === "member_buffering") {
        const uid = msg.userId as string;
        const isBuf = msg.isBuffering as boolean;
        setBufferingMembers(prev => {
          const next = new Set(prev);
          if (isBuf) next.add(uid); else next.delete(uid);
          return next;
        });
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
  }, [animeId, episode, onPlay, onPause, onSeek, onSync]);

  const createRoom = useCallback(() => {
    if (!isLoggedIn) return "";
    const rid = generateRoomId();
    connect(rid);
    return rid;
  }, [connect, isLoggedIn]);

  const joinRoom = useCallback((rid: string) => {
    if (!isLoggedIn) return;
    connect(rid.toUpperCase().trim());
  }, [connect, isLoggedIn]);

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

  const wsSend = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const sendPlay = useCallback((time: number) => {
    wsSend({ type: "play", time });
  }, [wsSend]);

  const sendPause = useCallback((time: number) => {
    wsSend({ type: "pause", time });
  }, [wsSend]);

  const sendSeek = useCallback((time: number) => {
    wsSend({ type: "seek", time });
  }, [wsSend]);

  const sendSync = useCallback((time: number) => {
    wsSend({ type: "sync", time });
  }, [wsSend]);

  const sendSyncRequest = useCallback(() => {
    wsSend({ type: "sync_request" });
  }, [wsSend]);

  const sendBuffering = useCallback((isBuffering: boolean) => {
    wsSend({ type: "buffering", isBuffering });
  }, [wsSend]);

  const sendChat = useCallback((text: string) => {
    wsSend({ type: "chat", text });
  }, [wsSend]);

  const setUserName = useCallback((name: string) => {
    userRef.current = { ...userRef.current, name };
    localStorage.setItem("wt_user", JSON.stringify(userRef.current));
  }, []);

  // Auto-join from URL param (only when logged in)
  useEffect(() => {
    if (!isLoggedIn) return;
    const params = new URLSearchParams(window.location.search);
    const rid = params.get("room");
    if (rid && rid.length === 6) {
      connect(rid.toUpperCase());
    }
    return () => {
      wsRef.current?.close();
      if (pingRef.current) clearInterval(pingRef.current);
    };
  }, [isLoggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const user = userRef.current;
  const isHost = hostId === user.id;

  return {
    status,
    roomId,
    members,
    chat,
    hostId,
    isHost,
    isLoggedIn,
    user,
    joinNotice,
    leftNotice,
    syncNotice,
    syncRequest,
    bufferingMembers,
    createRoom,
    joinRoom,
    leaveRoom,
    sendPlay,
    sendPause,
    sendSeek,
    sendSync,
    sendSyncRequest,
    sendBuffering,
    sendChat,
    setUserName,
  };
}

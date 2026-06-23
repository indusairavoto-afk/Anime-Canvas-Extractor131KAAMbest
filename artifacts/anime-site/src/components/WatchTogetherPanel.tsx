import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, X, Copy, Check, Send, Crown, LogOut, Link2, ChevronDown, ChevronUp, Radio } from "lucide-react";
import type { WTMember, WTChatMsg, WTStatus } from "@/hooks/useWatchTogether";

interface Props {
  status: WTStatus;
  roomId: string | null;
  members: WTMember[];
  chat: WTChatMsg[];
  isHost: boolean;
  user: { id: string; name: string; color: string };
  joinNotice: string | null;
  syncNotice: string | null;
  onCreateRoom: () => void;
  onJoinRoom: (id: string) => void;
  onLeave: () => void;
  onSendChat: (text: string) => void;
  onSyncNow: () => void;
}

function Avatar({ member, size = 28 }: { member: WTMember; size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-black shrink-0 relative"
      style={{ width: size, height: size, background: member.color, fontSize: size * 0.38 }}
    >
      {member.name[0].toUpperCase()}
      {member.isHost && (
        <Crown className="absolute -top-1.5 -right-1 text-yellow-400 drop-shadow" style={{ width: 11, height: 11 }} />
      )}
    </div>
  );
}

function RoomLink({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  const copy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-left"
    >
      <Link2 className="w-3.5 h-3.5 text-white/40 shrink-0" />
      <span className="text-[11px] text-white/50 truncate flex-1 font-mono">{url}</span>
      {copied
        ? <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
        : <Copy className="w-3.5 h-3.5 text-white/30 shrink-0" />}
    </button>
  );
}

export function WatchTogetherPanel({
  status, roomId, members, chat, isHost, user, joinNotice, syncNotice,
  onCreateRoom, onJoinRoom, onLeave, onSendChat, onSyncNow,
}: Props) {
  const [open, setOpen] = useState(false);
  const [joinInput, setJoinInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [showChat, setShowChat] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  // Auto-open when connected
  useEffect(() => {
    if (status === "connected") setOpen(true);
  }, [status]);

  const handleSendChat = () => {
    const t = chatInput.trim();
    if (!t) return;
    onSendChat(t);
    setChatInput("");
  };

  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <>
      {/* Join notice toast */}
      <AnimatePresence>
        {joinNotice && (
          <motion.div
            key="join-notice"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="fixed top-16 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-full bg-white/10 backdrop-blur-xl border border-white/15 text-sm text-white font-medium shadow-xl pointer-events-none"
          >
            👋 {joinNotice}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sync notice toast */}
      <AnimatePresence>
        {syncNotice && (
          <motion.div
            key="sync-notice"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="fixed top-16 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-full bg-blue-500/20 backdrop-blur-xl border border-blue-400/30 text-sm text-blue-200 font-medium shadow-xl pointer-events-none flex items-center gap-2"
          >
            <Radio className="w-3.5 h-3.5 text-blue-400" />
            {syncNotice}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating panel */}
      <div className="relative">
        {/* Trigger button */}
        <button
          onClick={() => setOpen((o) => !o)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12px] font-semibold transition-all ${
            isConnected
              ? "bg-white/10 border-white/20 text-white"
              : "bg-white/5 border-white/10 text-white/50 hover:text-white hover:border-white/20"
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          {isConnected ? (
            <>
              <span>{members.length} watching</span>
              <div className="flex -space-x-1.5">
                {members.slice(0, 3).map((m) => (
                  <div
                    key={m.id}
                    className="w-4 h-4 rounded-full border border-black flex items-center justify-center text-[8px] font-bold text-black"
                    style={{ background: m.color }}
                  >
                    {m.name[0]}
                  </div>
                ))}
              </div>
            </>
          ) : isConnecting ? (
            <span>Connecting…</span>
          ) : (
            <span>Watch Together</span>
          )}
        </button>

        {/* Panel */}
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -8 }}
              transition={{ duration: 0.18 }}
              className="absolute right-0 top-full mt-2 z-50 w-80 rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
              style={{ background: "rgba(14,14,14,0.97)", backdropFilter: "blur(24px)" }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07]">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-white/60" />
                  <span className="text-[13px] font-semibold text-white">Watch Together</span>
                  {isConnected && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
                      LIVE · {members.length}
                    </span>
                  )}
                </div>
                <button onClick={() => setOpen(false)} className="text-white/30 hover:text-white transition-colors p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Not connected state */}
              {!isConnected && !isConnecting && (
                <div className="p-4 flex flex-col gap-3">
                  <p className="text-[12px] text-white/50 leading-relaxed">
                    Watch anime in sync with friends — play, pause, and seek together in real time.
                  </p>
                  <button
                    onClick={onCreateRoom}
                    className="w-full py-2.5 rounded-xl bg-white text-black text-[13px] font-bold hover:bg-white/90 transition-colors"
                  >
                    Create Room
                  </button>
                  <div className="flex gap-2">
                    <input
                      value={joinInput}
                      onChange={(e) => setJoinInput(e.target.value.toUpperCase().slice(0, 6))}
                      placeholder="Room code (6 chars)"
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[12px] text-white placeholder-white/25 outline-none focus:border-white/25 font-mono uppercase tracking-widest"
                      onKeyDown={(e) => e.key === "Enter" && joinInput.length === 6 && onJoinRoom(joinInput)}
                    />
                    <button
                      disabled={joinInput.length !== 6}
                      onClick={() => onJoinRoom(joinInput)}
                      className="px-3 py-2 rounded-xl bg-white/10 text-white text-[12px] font-semibold border border-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Join
                    </button>
                  </div>
                </div>
              )}

              {/* Connecting */}
              {isConnecting && (
                <div className="p-6 flex flex-col items-center gap-3">
                  <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <p className="text-[12px] text-white/50">Connecting to room…</p>
                </div>
              )}

              {/* Connected state */}
              {isConnected && roomId && (
                <div className="flex flex-col">
                  {/* Invite link */}
                  <div className="px-3 pt-3 pb-2">
                    <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1.5 font-mono">Invite Link</p>
                    <RoomLink roomId={roomId} />
                    <p className="text-[10px] text-white/25 mt-1.5 text-center font-mono">
                      Room · <span className="text-white/50 font-bold tracking-widest">{roomId}</span>
                      {isHost && <span className="ml-2 text-yellow-400/70">You are host</span>}
                    </p>
                  </div>

                  {/* Sync Now */}
                  <div className="px-3 pb-2">
                    <button
                      onClick={onSyncNow}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300 text-[12px] font-semibold hover:bg-blue-500/20 hover:border-blue-400/30 transition-colors"
                    >
                      <Radio className="w-3.5 h-3.5" />
                      Sync Now — pull everyone to my timestamp
                    </button>
                  </div>

                  {/* Members list */}
                  <div className="px-3 pb-2">
                    <p className="text-[10px] text-white/30 uppercase tracking-widest mb-2 font-mono">Viewers ({members.length})</p>
                    <div className="flex flex-col gap-1.5 max-h-28 overflow-y-auto">
                      {members.map((m) => (
                        <div key={m.id} className="flex items-center gap-2">
                          <Avatar member={m} size={26} />
                          <span className="text-[12px] text-white/80 flex-1 truncate">{m.name}</span>
                          {m.id === user.id && <span className="text-[9px] text-white/30 font-mono">YOU</span>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Chat section */}
                  <div className="border-t border-white/[0.07]">
                    <button
                      onClick={() => setShowChat((s) => !s)}
                      className="flex items-center justify-between w-full px-3 py-2 text-[10px] text-white/30 uppercase tracking-widest font-mono hover:text-white/50 transition-colors"
                    >
                      <span>Chat</span>
                      {showChat ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                    {showChat && (
                      <>
                        <div className="px-3 pb-1 h-32 overflow-y-auto flex flex-col gap-1.5">
                          {chat.length === 0 && (
                            <p className="text-[11px] text-white/20 text-center mt-6">No messages yet…</p>
                          )}
                          {chat.map((msg, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <div
                                className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-black shrink-0 mt-0.5"
                                style={{ background: msg.color }}
                              >
                                {msg.name[0]}
                              </div>
                              <div className="min-w-0">
                                <span className="text-[10px] font-semibold" style={{ color: msg.color }}>{msg.name} </span>
                                <span className="text-[11px] text-white/70 break-words">{msg.text}</span>
                              </div>
                            </div>
                          ))}
                          <div ref={chatEndRef} />
                        </div>
                        <div className="flex items-center gap-2 px-3 pb-3 pt-1">
                          <input
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
                            placeholder="Say something…"
                            maxLength={300}
                            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-white placeholder-white/20 outline-none focus:border-white/25 transition-colors"
                          />
                          <button
                            onClick={handleSendChat}
                            disabled={!chatInput.trim()}
                            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <Send className="w-3.5 h-3.5 text-white/70" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Leave */}
                  <div className="px-3 pb-3">
                    <button
                      onClick={onLeave}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-white/5 border border-white/10 text-white/40 text-[12px] font-semibold hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400 transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" /> Leave Room
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

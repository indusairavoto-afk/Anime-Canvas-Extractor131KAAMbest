import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { apiUrl } from "@/lib/api";

type VoteCategory = "skip" | "timepass" | "go_for_it" | "perfection";
type VoteCounts = Record<VoteCategory, number>;

interface ReviewRow {
  id: number;
  username: string;
  avatarUrl: string;
  rating: VoteCategory;
  content: string;
  spoiler: boolean;
  likes: number;
  createdAt: string;
}

const CATS = [
  { key: "skip"        as VoteCategory, label: "Skip",       color: "#6b7280", accent: "#9ca3af" },
  { key: "timepass"    as VoteCategory, label: "Timepass",   color: "#d97706", accent: "#fbbf24" },
  { key: "go_for_it"   as VoteCategory, label: "Go For It",  color: "#059669", accent: "#34d399" },
  { key: "perfection"  as VoteCategory, label: "Perfection", color: "#7c3aed", accent: "#a78bfa" },
] as const;

const CAT_MAP = Object.fromEntries(CATS.map(c => [c.key, c])) as Record<VoteCategory, typeof CATS[number]>;

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

interface Props {
  animeId: string;
  episode: number;
  episodeTitle: string;
  onPostReview?: (text: string, category: VoteCategory, spoiler: boolean) => void;
}

export function EpisodeRatingMeter({ animeId, episode, episodeTitle, onPostReview }: Props) {
  const [counts, setCounts] = useState<VoteCounts>({ skip: 0, timepass: 0, go_for_it: 0, perfection: 0 });
  const [myVote, setMyVote] = useState<VoteCategory | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reviewText, setReviewText] = useState("");
  const [reviewPosted, setReviewPosted] = useState(false);
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [revealedIds, setRevealedIds] = useState<Set<number>>(new Set());
  const [likedIds, setLikedIds] = useState<Set<number>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchReviews = useCallback(async () => {
    try {
      const r = await fetch(apiUrl(`/api/anime/${animeId}/episode/${episode}/reviews`));
      if (r.ok) setReviews(await r.json());
    } catch {}
  }, [animeId, episode]);

  useEffect(() => {
    const stored = localStorage.getItem(`na_vote_${animeId}_${episode}`) as VoteCategory | null;
    setMyVote(stored);
    setReviewPosted(!!localStorage.getItem(`na_review_posted_${animeId}_${episode}`));
    fetch(apiUrl(`/api/votes/${animeId}/${episode}`))
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setCounts(data as VoteCounts); })
      .catch(() => {});
    fetchReviews();
  }, [animeId, episode, fetchReviews]);

  const total = CATS.reduce((s, c) => s + counts[c.key], 0);
  const shares = CATS.map(c => total > 0 ? counts[c.key] / total : 0);
  const domIdx = shares.reduce((best, s, i) => s > shares[best] ? i : best, 0);
  const domScore = total > 0 ? Math.round(shares[domIdx] * 100) : 0;
  const domCat = total > 0 ? CATS[domIdx] : null;
  const activeCat = myVote ? CAT_MAP[myVote] : null;

  const R = 72, CX = 92, CY = 86, STROKE = 8;
  const arcPath = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;

  const castVote = async (cat: VoteCategory) => {
    if (submitting) return;
    const isToggleOff = myVote === cat;
    setSubmitting(true);

    if (isToggleOff) {
      setMyVote(null);
      setCounts(c => ({ ...c, [cat]: Math.max(0, c[cat] - 1) }));
      localStorage.removeItem(`na_vote_${animeId}_${episode}`);
      setSubmitting(false);
      return;
    }

    const prev = myVote;
    setMyVote(cat);
    setCounts(c => {
      const next = { ...c };
      if (prev) next[prev] = Math.max(0, next[prev] - 1);
      next[cat] = (next[cat] ?? 0) + 1;
      return next;
    });

    try {
      let voterKey = localStorage.getItem("na_voter_key");
      if (!voterKey) { voterKey = crypto.randomUUID(); localStorage.setItem("na_voter_key", voterKey); }
      const res = await fetch(apiUrl(`/api/votes/${animeId}/${episode}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: cat, voterKey }),
      });
      if (res.ok) {
        setCounts(await res.json() as VoteCounts);
        localStorage.setItem(`na_vote_${animeId}_${episode}`, cat);
      } else {
        setMyVote(prev);
        fetch(apiUrl(`/api/votes/${animeId}/${episode}`))
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) setCounts(d as VoteCounts); })
          .catch(() => {});
      }
    } catch {
      setMyVote(myVote);
    } finally {
      setSubmitting(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  const handlePostReview = async () => {
    if (!myVote || !reviewText.trim() || reviewPosted) return;
    const username = localStorage.getItem("na_username") || "Anonymous";
    const voterKey = localStorage.getItem("na_voter_key") ?? undefined;
    try {
      const res = await fetch(apiUrl(`/api/anime/${animeId}/episode/${episode}/reviews`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, rating: myVote, content: reviewText.trim(), spoiler: isSpoiler, voterKey }),
      });
      if (res.ok) {
        const newReview: ReviewRow = await res.json();
        setReviews(prev => [newReview, ...prev]);
      }
    } catch {}
    onPostReview?.(reviewText.trim(), myVote, isSpoiler);
    localStorage.setItem(`na_review_posted_${animeId}_${episode}`, "1");
    setReviewPosted(true);
    setReviewText("");
    setIsSpoiler(false);
  };

  const handleLike = async (id: number) => {
    if (likedIds.has(id)) return;
    setLikedIds(prev => new Set(prev).add(id));
    setReviews(prev => prev.map(r => r.id === id ? { ...r, likes: r.likes + 1 } : r));
    try {
      await fetch(apiUrl(`/api/reviews/${id}/like`), { method: "POST" });
    } catch {}
  };

  return (
    <div className="py-8 border-t border-white/[0.05]">

      {/* Label */}
      <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white/20 mb-6">
        Nexa Meter — Episode {episode}
        {episodeTitle && episodeTitle !== `Episode ${episode}` && (
          <span className="text-white/10"> / {episodeTitle}</span>
        )}
      </p>

      <div className="flex gap-8 items-start">
        {/* Arc */}
        <div className="shrink-0">
          <svg viewBox="0 0 184 96" width="160" height="84" className="overflow-visible">
            <path d={arcPath} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={STROKE} strokeLinecap="round" pathLength="100" />
            {(() => {
              const els: React.ReactNode[] = [];
              let off = 0;
              CATS.forEach((cat, i) => {
                const share = shares[i] * 100;
                const segOff = off;
                off += share;
                if (share < 0.5) return;
                const isActive = myVote === cat.key;
                els.push(
                  <path
                    key={cat.key}
                    d={arcPath}
                    fill="none"
                    stroke={cat.accent}
                    strokeWidth={isActive ? STROKE + 2 : STROKE - 1}
                    strokeLinecap="butt"
                    pathLength="100"
                    strokeDasharray={`${Math.max(share - 0.5, 0)} ${100 - Math.max(share - 0.5, 0)}`}
                    strokeDashoffset={-segOff}
                    opacity={isActive ? 1 : 0.45}
                    style={{ transition: "stroke-dasharray 0.5s cubic-bezier(0.4,0,0.2,1), opacity 0.2s, stroke-width 0.2s" }}
                  />
                );
              });
              return els;
            })()}
            {total > 0 ? (
              <>
                <text x={CX} y={CY - 20} textAnchor="middle" fontSize="26" fontWeight="700"
                  fill={domCat?.accent ?? "#fff"} fontFamily="system-ui,sans-serif"
                  style={{ transition: "fill 0.4s" }}>
                  {domScore}%
                </text>
                <text x={CX} y={CY - 7} textAnchor="middle" fontSize="7"
                  fill="rgba(255,255,255,0.2)" fontFamily="monospace" letterSpacing="1">
                  {total.toLocaleString()} votes
                </text>
              </>
            ) : (
              <text x={CX} y={CY - 12} textAnchor="middle" fontSize="7.5"
                fill="rgba(255,255,255,0.15)" fontFamily="monospace" letterSpacing="1.5">
                RATE EPISODE
              </text>
            )}
          </svg>
        </div>

        {/* Breakdown bars */}
        <div className="flex-1 min-w-0 pt-1 space-y-2">
          {CATS.map((cat, i) => {
            const pct = total > 0 ? Math.round(shares[i] * 100) : 0;
            const isMe = myVote === cat.key;
            return (
              <div key={cat.key} className="flex items-center gap-2">
                <span className="w-14 text-[9px] font-mono uppercase tracking-wide shrink-0 text-right"
                  style={{ color: isMe ? cat.accent : "rgba(255,255,255,0.2)" }}>
                  {cat.label}
                </span>
                <div className="flex-1 h-[3px] bg-white/[0.05] rounded-full overflow-hidden">
                  <motion.div className="h-full rounded-full"
                    style={{ background: cat.accent, opacity: isMe ? 1 : 0.4 }}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }} />
                </div>
                <span className="w-7 text-[9px] font-mono tabular-nums text-right shrink-0"
                  style={{ color: isMe ? cat.accent : "rgba(255,255,255,0.18)" }}>
                  {pct > 0 ? `${pct}%` : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Review Input Box */}
      <div className="mt-6 border-t border-white/[0.05] pt-5 space-y-3">
        {reviewPosted ? (
          <div className="flex items-center gap-2 py-2.5 px-3 border border-white/[0.06] bg-white/[0.02]" style={{ borderRadius: "2px" }}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: activeCat?.accent }} />
            <span className="text-[10px] font-mono text-white/30 tracking-wide">Review posted · thanks!</span>
          </div>
        ) : (
          <>
            {/* Vote chips inside box */}
            <div className="flex gap-1.5 flex-wrap">
              {CATS.map(cat => {
                const isMe = myVote === cat.key;
                return (
                  <motion.button
                    key={cat.key}
                    onClick={() => castVote(cat.key)}
                    disabled={submitting}
                    whileTap={{ scale: 0.95 }}
                    className="px-3.5 py-1.5 text-[11px] font-medium transition-all duration-150 cursor-pointer select-none"
                    style={{
                      borderRadius: "999px",
                      border: `1px solid ${isMe ? cat.accent + "70" : "rgba(255,255,255,0.07)"}`,
                      background: isMe ? cat.color + "22" : "rgba(255,255,255,0.03)",
                      color: isMe ? cat.accent : "rgba(255,255,255,0.35)",
                    }}
                  >
                    {cat.label}
                  </motion.button>
                );
              })}
            </div>

            {/* Textarea */}
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={reviewText}
                onChange={e => setReviewText(e.target.value.slice(0, 1000))}
                placeholder="Write your review here..."
                rows={3}
                maxLength={1000}
                className="w-full bg-transparent border border-white/[0.07] px-3 py-2.5 text-xs text-white/80 placeholder-white/15 focus:outline-none focus:border-white/20 resize-none transition-colors"
                style={{
                  borderColor: reviewText.trim() ? (activeCat?.color ?? "") + "45" : undefined,
                  borderRadius: "2px",
                }}
              />
              <span className="absolute bottom-2 right-2.5 text-[8px] font-mono text-white/15 tabular-nums">
                {reviewText.length}/1000
              </span>
            </div>

            <div className="flex items-center justify-between">
              <motion.button type="button" onClick={() => setIsSpoiler(v => !v)} whileTap={{ scale: 0.96 }} className="flex items-center gap-2">
                <div className="relative w-7 h-3.5 rounded-full shrink-0 transition-all duration-200"
                  style={{ background: isSpoiler ? "rgba(124,58,237,0.5)" : "rgba(255,255,255,0.07)" }}>
                  <motion.span
                    animate={{ x: isSpoiler ? 14 : 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    className="absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white/80"
                  />
                </div>
                <span className="text-[9px] font-mono uppercase tracking-wider transition-colors duration-200"
                  style={{ color: isSpoiler ? "rgba(167,139,250,0.8)" : "rgba(255,255,255,0.2)" }}>
                  {isSpoiler ? "Spoiler" : "Mark spoiler"}
                </span>
              </motion.button>

              <motion.button
                onClick={handlePostReview}
                disabled={!myVote || !reviewText.trim()}
                whileTap={{ scale: 0.96 }}
                className="px-5 py-1.5 text-[10px] font-medium transition-all duration-200 disabled:opacity-25 disabled:cursor-not-allowed"
                style={{
                  borderRadius: "999px",
                  border: `1px solid ${myVote && reviewText.trim() ? (activeCat?.accent ?? "#fff") + "60" : "rgba(255,255,255,0.08)"}`,
                  color: myVote && reviewText.trim() ? activeCat?.accent : "rgba(255,255,255,0.2)",
                  background: myVote && reviewText.trim() ? (activeCat?.color ?? "") + "18" : "transparent",
                }}
              >
                Post
              </motion.button>
            </div>
          </>
        )}
      </div>

      {/* Reviews List */}
      <AnimatePresence>
        {reviews.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-6 border-t border-white/[0.05] pt-5 space-y-4"
          >
            <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white/20">
              {reviews.length} Review{reviews.length !== 1 ? "s" : ""}
            </p>

            {reviews.map(review => {
              const cat = CAT_MAP[review.rating];
              const revealed = revealedIds.has(review.id);
              const liked = likedIds.has(review.id);
              return (
                <motion.div
                  key={review.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3"
                >
                  {/* Avatar */}
                  <div className="w-6 h-6 shrink-0 rounded-full overflow-hidden bg-white/[0.06] mt-0.5">
                    <img src={review.avatarUrl} alt="" className="w-full h-full" />
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-[10px] font-semibold text-white/60">{review.username}</span>
                      <span
                        className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5"
                        style={{
                          color: cat.accent,
                          background: cat.color + "18",
                          border: `1px solid ${cat.accent}30`,
                          borderRadius: "3px",
                        }}
                      >
                        {cat.label}
                      </span>
                      {review.spoiler && (
                        <span className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 text-purple-400/60 bg-purple-500/10 border border-purple-500/20" style={{ borderRadius: "3px" }}>
                          spoiler
                        </span>
                      )}
                      <span className="text-[9px] font-mono text-white/20 ml-auto">{timeAgo(review.createdAt)}</span>
                    </div>

                    {/* Content */}
                    {review.spoiler && !revealed ? (
                      <button
                        onClick={() => setRevealedIds(prev => new Set(prev).add(review.id))}
                        className="w-full text-left relative group mb-2"
                      >
                        <p className="text-[11px] text-white/50 leading-relaxed blur-sm select-none pointer-events-none line-clamp-2">
                          {review.content}
                        </p>
                        <div className="absolute inset-0 flex items-center">
                          <span className="text-[9px] font-mono text-purple-400/70 uppercase tracking-widest group-hover:text-purple-400 transition-colors">
                            ⚠ Click to reveal
                          </span>
                        </div>
                      </button>
                    ) : (
                      <p className="text-sm text-white/70 leading-relaxed mb-2">{review.content}</p>
                    )}

                    {/* Like */}
                    <button
                      onClick={() => handleLike(review.id)}
                      className="flex items-center gap-1 transition-colors"
                      style={{ color: liked ? cat.accent : "rgba(255,255,255,0.2)" }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                      </svg>
                      <span className="text-[9px] font-mono tabular-nums">{review.likes > 0 ? review.likes : ""}</span>
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

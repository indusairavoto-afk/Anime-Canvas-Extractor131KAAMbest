import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { apiUrl } from "@/lib/api";

type VoteCategory = "skip" | "timepass" | "go_for_it" | "perfection";
type VoteCounts = Record<VoteCategory, number>;

const CATS = [
  { key: "skip" as VoteCategory,       label: "Skip",       color: "#ef4444", glow: "rgba(239,68,68,0.45)",  border: "border-red-500/60",    bg: "rgba(239,68,68,0.08)"  },
  { key: "timepass" as VoteCategory,   label: "Timepass",   color: "#f59e0b", glow: "rgba(245,158,11,0.45)", border: "border-amber-400/60",  bg: "rgba(245,158,11,0.08)" },
  { key: "go_for_it" as VoteCategory,  label: "Go For It",  color: "#22c55e", glow: "rgba(34,197,94,0.45)",  border: "border-green-500/60",  bg: "rgba(34,197,94,0.08)"  },
  { key: "perfection" as VoteCategory, label: "Perfection", color: "#a855f7", glow: "rgba(168,85,247,0.45)", border: "border-purple-500/60", bg: "rgba(168,85,247,0.08)" },
] as const;

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
  const [reviewCharCount, setReviewCharCount] = useState(0);
  const [isSpoiler, setIsSpoiler] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load vote from localStorage + fetch counts
  useEffect(() => {
    const storedVote = localStorage.getItem(`na_vote_${animeId}_${episode}`) as VoteCategory | null;
    setMyVote(storedVote);
    setReviewPosted(!!localStorage.getItem(`na_review_posted_${animeId}_${episode}`));
    fetch(apiUrl(`/api/votes/${animeId}/${episode}`))
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setCounts(data as VoteCounts); })
      .catch(() => {});
  }, [animeId, episode]);

  const total = CATS.reduce((s, c) => s + counts[c.key], 0);
  const shares = CATS.map(c => total > 0 ? counts[c.key] / total : 0);
  const domIdx = shares.reduce((best, s, i) => s > shares[best] ? i : best, 0);
  const domScore = total > 0 ? Math.round(shares[domIdx] * 100) : 0;
  const domCat = CATS[domIdx];

  // SVG arc geometry
  const R = 90;
  const CX = 115;
  const CY = 112;
  const arcPath = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;
  const STROKE = 18;

  const castVote = async (cat: VoteCategory) => {
    if (submitting) return;
    setSubmitting(true);
    const prev = myVote;
    setMyVote(cat);
    // Optimistic update
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
        const data = await res.json() as VoteCounts;
        setCounts(data);
        localStorage.setItem(`na_vote_${animeId}_${episode}`, cat);
      } else {
        setMyVote(prev);
        fetch(apiUrl(`/api/votes/${animeId}/${episode}`))
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) setCounts(d as VoteCounts); })
          .catch(() => {});
      }
    } catch {
      setMyVote(prev);
    } finally {
      setSubmitting(false);
      // Focus textarea after vote
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  const handlePostReview = () => {
    if (!myVote || !reviewText.trim() || reviewPosted) return;
    onPostReview?.(reviewText.trim(), myVote, isSpoiler);
    localStorage.setItem(`na_review_posted_${animeId}_${episode}`, "1");
    setReviewPosted(true);
    setReviewText("");
    setIsSpoiler(false);
  };

  let cumOffset = 0;

  return (
    <div className="border-t border-white/[0.06] pt-8 mt-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 px-1">
        <div>
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/25 mb-1">Nexa Meter</p>
          <h4 className="text-sm font-semibold text-white leading-tight">
            Episode {episode}
            {episodeTitle && episodeTitle !== `Episode ${episode}` && (
              <span className="text-white/30 font-normal"> — {episodeTitle}</span>
            )}
          </h4>
        </div>
        {total > 0 && (
          <span className="text-[10px] font-mono text-white/20 tabular-nums tracking-wide">
            {total.toLocaleString()} vote{total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Arc Gauge */}
      <div className="flex flex-col items-center">
        <div className="relative w-full max-w-[300px]">
          <svg viewBox="0 0 230 126" className="w-full overflow-visible">
            <defs>
              {CATS.map(c => (
                <filter key={c.key} id={`rm-glow-${c.key}`} x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              ))}
              <filter id="rm-center-glow" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="8" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Track background */}
            <path
              d={arcPath}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={STROKE}
              strokeLinecap="round"
              pathLength="100"
            />

            {/* Colored segments */}
            {CATS.map((cat, i) => {
              const share = shares[i] * 100;
              const offset = cumOffset;
              cumOffset += share;
              if (share < 0.3) return null;
              const isActive = myVote === cat.key;
              return (
                <path
                  key={cat.key}
                  d={arcPath}
                  fill="none"
                  stroke={cat.color}
                  strokeWidth={isActive ? STROKE + 3 : STROKE}
                  strokeLinecap="butt"
                  pathLength="100"
                  strokeDasharray={`${Math.max(share - 0.4, 0)} ${100 - Math.max(share - 0.4, 0)}`}
                  strokeDashoffset={-offset}
                  filter={isActive ? `url(#rm-glow-${cat.key})` : undefined}
                  style={{ transition: "stroke-dasharray 0.55s cubic-bezier(0.4,0,0.2,1), stroke-width 0.2s" }}
                />
              );
            })}

            {/* Center content */}
            {total > 0 ? (
              <>
                <text
                  x={CX} y={CY - 22}
                  textAnchor="middle"
                  fontSize="32"
                  fontWeight="800"
                  fill={domCat.color}
                  fontFamily="system-ui,sans-serif"
                  filter={`url(#rm-center-glow)`}
                  style={{ transition: "fill 0.4s" }}
                >
                  {domScore}%
                </text>
                <text
                  x={CX} y={CY - 6}
                  textAnchor="middle"
                  fontSize="8"
                  fill="rgba(255,255,255,0.25)"
                  fontFamily="monospace"
                  letterSpacing="0.8"
                >
                  {counts[domCat.key].toLocaleString()}/{total.toLocaleString()} Votes
                </text>
              </>
            ) : (
              <text
                x={CX} y={CY - 12}
                textAnchor="middle"
                fontSize="10"
                fill="rgba(255,255,255,0.18)"
                fontFamily="monospace"
                letterSpacing="1.5"
              >
                RATE THIS EPISODE
              </text>
            )}
          </svg>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 mt-1 mb-6 w-full max-w-sm px-2">
          {CATS.map((cat, i) => (
            <div key={cat.key} className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cat.color }} />
              <span
                className="text-[10px] font-mono"
                style={{ color: myVote === cat.key ? cat.color : "rgba(255,255,255,0.35)" }}
              >
                {cat.label}
              </span>
              <motion.span
                key={`${cat.key}-${Math.round(shares[i] * 100)}`}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-[10px] font-mono tabular-nums ml-auto"
                style={{ color: cat.color, opacity: 0.8 }}
              >
                {total > 0 ? `${Math.round(shares[i] * 100)}%` : "—"}
              </motion.span>
            </div>
          ))}
        </div>

        {/* Vote buttons */}
        <div className="grid grid-cols-4 gap-2 w-full max-w-xs mb-5">
          {CATS.map(cat => {
            const isMe = myVote === cat.key;
            return (
              <motion.button
                key={cat.key}
                onClick={() => castVote(cat.key)}
                disabled={submitting}
                whileTap={{ scale: 0.93 }}
                whileHover={{ scale: 1.03 }}
                className="relative flex flex-col items-center gap-1.5 py-3 px-1 rounded-lg border transition-all duration-200 text-center cursor-pointer"
                style={isMe
                  ? { borderColor: cat.color, background: cat.bg, boxShadow: `0 0 18px ${cat.glow}, inset 0 0 12px ${cat.glow}` }
                  : { borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }
                }
              >
                <motion.span
                  animate={isMe
                    ? { scale: [1, 1.4, 1], opacity: 1 }
                    : { scale: 1, opacity: 0.4 }
                  }
                  transition={{ duration: 0.35 }}
                  className="w-3 h-3 rounded-full"
                  style={{ background: isMe ? cat.color : "rgba(255,255,255,0.2)", boxShadow: isMe ? `0 0 10px ${cat.glow}` : "none" }}
                />
                <span
                  className="text-[8.5px] font-mono uppercase tracking-wide leading-tight transition-colors duration-200"
                  style={{ color: isMe ? cat.color : "rgba(255,255,255,0.3)" }}
                >
                  {cat.label}
                </span>
              </motion.button>
            );
          })}
        </div>

        {myVote && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[9px] font-mono text-white/20 mb-5 tracking-widest uppercase"
          >
            your vote · tap to change
          </motion.p>
        )}
      </div>

      {/* Review Box */}
      <AnimatePresence>
        {myVote && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.25 }}
            className="mt-2 space-y-3"
          >
            {reviewPosted ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-2 py-3 px-4 rounded-lg border border-white/10 bg-white/[0.03]"
              >
                <span className="w-2 h-2 rounded-full" style={{ background: CATS.find(c => c.key === myVote)?.color }} />
                <span className="text-xs text-white/40 font-mono">Review posted · thanks!</span>
              </motion.div>
            ) : (
              <>
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    value={reviewText}
                    onChange={e => {
                      const val = e.target.value.slice(0, 1000);
                      setReviewText(val);
                      setReviewCharCount(val.length);
                    }}
                    placeholder="Write your review here..."
                    rows={4}
                    maxLength={1000}
                    className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-4 py-3 text-xs text-white placeholder-white/20 focus:outline-none focus:border-white/25 resize-none transition-colors"
                    style={{ borderColor: reviewText.trim() ? CATS.find(c => c.key === myVote)?.color + "40" : undefined }}
                  />
                  <span className="absolute bottom-2 right-3 text-[9px] font-mono text-white/20 tabular-nums">
                    {reviewCharCount}/1000
                  </span>
                </div>

                {/* Spoiler toggle */}
                <motion.button
                  type="button"
                  onClick={() => setIsSpoiler(v => !v)}
                  whileTap={{ scale: 0.97 }}
                  className="flex items-center gap-2.5 w-fit group"
                >
                  <div
                    className="relative w-8 h-4 rounded-full transition-all duration-200 shrink-0"
                    style={{
                      background: isSpoiler ? "rgba(168,85,247,0.6)" : "rgba(255,255,255,0.08)",
                      boxShadow: isSpoiler ? "0 0 10px rgba(168,85,247,0.4)" : "none",
                    }}
                  >
                    <motion.span
                      animate={{ x: isSpoiler ? 16 : 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white"
                    />
                  </div>
                  <span
                    className="text-[10px] font-mono uppercase tracking-wider transition-colors duration-200"
                    style={{ color: isSpoiler ? "rgba(168,85,247,0.9)" : "rgba(255,255,255,0.25)" }}
                  >
                    {isSpoiler ? "⚠ Spoiler" : "Mark as spoiler"}
                  </span>
                </motion.button>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: CATS.find(c => c.key === myVote)?.color }}
                    />
                    <span
                      className="text-[10px] font-mono"
                      style={{ color: CATS.find(c => c.key === myVote)?.color }}
                    >
                      {CATS.find(c => c.key === myVote)?.label}
                    </span>
                  </div>

                  <motion.button
                    onClick={handlePostReview}
                    disabled={!reviewText.trim()}
                    whileTap={{ scale: 0.96 }}
                    className="px-6 py-2 rounded-lg text-xs font-mono uppercase tracking-widest transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={reviewText.trim()
                      ? {
                          background: CATS.find(c => c.key === myVote)?.color,
                          color: "#000",
                          boxShadow: `0 0 20px ${CATS.find(c => c.key === myVote)?.glow}`,
                        }
                      : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }
                    }
                  >
                    Post Review
                  </motion.button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

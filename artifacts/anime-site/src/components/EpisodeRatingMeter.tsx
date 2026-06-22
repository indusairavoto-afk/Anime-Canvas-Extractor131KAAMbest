import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { apiUrl } from "@/lib/api";

type VoteCategory = "skip" | "timepass" | "go_for_it" | "perfection";
type VoteCounts = Record<VoteCategory, number>;

const CATS = [
  { key: "skip"        as VoteCategory, label: "Skip",       color: "#6b7280", accent: "#9ca3af" },
  { key: "timepass"    as VoteCategory, label: "Timepass",   color: "#d97706", accent: "#fbbf24" },
  { key: "go_for_it"   as VoteCategory, label: "Go For It",  color: "#059669", accent: "#34d399" },
  { key: "perfection"  as VoteCategory, label: "Perfection", color: "#7c3aed", accent: "#a78bfa" },
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
  const [isSpoiler, setIsSpoiler] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem(`na_vote_${animeId}_${episode}`) as VoteCategory | null;
    setMyVote(stored);
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
  const domCat = total > 0 ? CATS[domIdx] : null;
  const activeCat = CATS.find(c => c.key === myVote) ?? null;

  // Arc geometry
  const R = 72, CX = 92, CY = 86, STROKE = 8;
  const arcPath = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;
  let cumOffset = 0;

  const castVote = async (cat: VoteCategory) => {
    if (submitting) return;
    const isToggleOff = myVote === cat;
    const prev = myVote;
    setSubmitting(true);

    if (isToggleOff) {
      // Deselect — optimistic
      setMyVote(null);
      setCounts(c => ({ ...c, [cat]: Math.max(0, c[cat] - 1) }));
      localStorage.removeItem(`na_vote_${animeId}_${episode}`);
      // No server-side "unvote" endpoint, just refresh counts
      fetch(apiUrl(`/api/votes/${animeId}/${episode}`))
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setCounts(d as VoteCounts); })
        .catch(() => {});
      setSubmitting(false);
      return;
    }

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
          <svg viewBox={`0 0 184 96`} width="160" height="84" className="overflow-visible">
            {/* Track */}
            <path
              d={arcPath}
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={STROKE}
              strokeLinecap="round"
              pathLength="100"
            />

            {/* Segments */}
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

            {/* Center text */}
            {total > 0 ? (
              <>
                <text
                  x={CX} y={CY - 20}
                  textAnchor="middle"
                  fontSize="26"
                  fontWeight="700"
                  fill={domCat?.accent ?? "#fff"}
                  fontFamily="system-ui,sans-serif"
                  style={{ transition: "fill 0.4s" }}
                >
                  {domScore}%
                </text>
                <text
                  x={CX} y={CY - 7}
                  textAnchor="middle"
                  fontSize="7"
                  fill="rgba(255,255,255,0.2)"
                  fontFamily="monospace"
                  letterSpacing="1"
                >
                  {total.toLocaleString()} votes
                </text>
              </>
            ) : (
              <text
                x={CX} y={CY - 12}
                textAnchor="middle"
                fontSize="7.5"
                fill="rgba(255,255,255,0.15)"
                fontFamily="monospace"
                letterSpacing="1.5"
              >
                RATE EPISODE
              </text>
            )}
          </svg>
        </div>

        {/* Right side: vote chips + breakdown */}
        <div className="flex-1 min-w-0 pt-1 space-y-4">

          {/* Vote chips */}
          <div className="flex flex-wrap gap-2">
            {CATS.map(cat => {
              const isMe = myVote === cat.key;
              return (
                <motion.button
                  key={cat.key}
                  onClick={() => castVote(cat.key)}
                  disabled={submitting}
                  whileTap={{ scale: 0.95 }}
                  className="relative flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-all duration-200 cursor-pointer select-none"
                  style={{
                    border: `1px solid ${isMe ? cat.accent + "80" : "rgba(255,255,255,0.08)"}`,
                    background: isMe ? cat.color + "18" : "transparent",
                    color: isMe ? cat.accent : "rgba(255,255,255,0.28)",
                    borderRadius: "3px",
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: isMe ? cat.accent : "rgba(255,255,255,0.15)" }}
                  />
                  {cat.label}
                </motion.button>
              );
            })}
          </div>

          {/* Breakdown bars */}
          <div className="space-y-2">
            {CATS.map((cat, i) => {
              const pct = total > 0 ? Math.round(shares[i] * 100) : 0;
              const isMe = myVote === cat.key;
              return (
                <div key={cat.key} className="flex items-center gap-2">
                  <span
                    className="w-14 text-[9px] font-mono uppercase tracking-wide shrink-0 text-right"
                    style={{ color: isMe ? cat.accent : "rgba(255,255,255,0.2)" }}
                  >
                    {cat.label}
                  </span>
                  <div className="flex-1 h-[3px] bg-white/[0.05] rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: cat.accent, opacity: isMe ? 1 : 0.4 }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                    />
                  </div>
                  <span
                    className="w-7 text-[9px] font-mono tabular-nums text-right shrink-0"
                    style={{ color: isMe ? cat.accent : "rgba(255,255,255,0.18)" }}
                  >
                    {pct > 0 ? `${pct}%` : "—"}
                  </span>
                </div>
              );
            })}
          </div>

          {myVote && (
            <p className="text-[8px] font-mono text-white/15 uppercase tracking-[0.2em]">
              tap again to remove vote
            </p>
          )}
        </div>
      </div>

      {/* Review Box */}
      <AnimatePresence>
        {myVote && (
          <motion.div
            key="review-box"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            className="mt-6 border-t border-white/[0.05] pt-5 space-y-3"
          >
            {reviewPosted ? (
              <div className="flex items-center gap-2 py-2.5 px-3 border border-white/[0.06] bg-white/[0.02]">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: activeCat?.accent }} />
                <span className="text-[10px] font-mono text-white/30 tracking-wide">Review posted · thanks!</span>
              </div>
            ) : (
              <>
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    value={reviewText}
                    onChange={e => setReviewText(e.target.value.slice(0, 1000))}
                    placeholder="Write your review here..."
                    rows={3}
                    maxLength={1000}
                    className="w-full bg-transparent border border-white/[0.08] px-3 py-2.5 text-xs text-white/80 placeholder-white/15 focus:outline-none focus:border-white/20 resize-none transition-colors"
                    style={{
                      borderColor: reviewText.trim() ? (activeCat?.color ?? "") + "50" : undefined,
                      borderRadius: "2px",
                    }}
                  />
                  <span className="absolute bottom-2 right-2.5 text-[8px] font-mono text-white/15 tabular-nums">
                    {reviewText.length}/1000
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  {/* Spoiler toggle */}
                  <motion.button
                    type="button"
                    onClick={() => setIsSpoiler(v => !v)}
                    whileTap={{ scale: 0.96 }}
                    className="flex items-center gap-2 group"
                  >
                    <div
                      className="relative w-7 h-3.5 rounded-full shrink-0 transition-all duration-200"
                      style={{ background: isSpoiler ? "rgba(124,58,237,0.5)" : "rgba(255,255,255,0.07)" }}
                    >
                      <motion.span
                        animate={{ x: isSpoiler ? 14 : 1 }}
                        transition={{ type: "spring", stiffness: 500, damping: 35 }}
                        className="absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white/80"
                      />
                    </div>
                    <span
                      className="text-[9px] font-mono uppercase tracking-wider transition-colors duration-200"
                      style={{ color: isSpoiler ? "rgba(167,139,250,0.8)" : "rgba(255,255,255,0.2)" }}
                    >
                      {isSpoiler ? "Spoiler" : "Mark spoiler"}
                    </span>
                  </motion.button>

                  {/* Post button */}
                  <motion.button
                    onClick={handlePostReview}
                    disabled={!reviewText.trim()}
                    whileTap={{ scale: 0.96 }}
                    className="px-4 py-1.5 text-[9px] font-mono uppercase tracking-[0.15em] transition-all duration-200 disabled:opacity-20 disabled:cursor-not-allowed"
                    style={{
                      border: `1px solid ${reviewText.trim() ? (activeCat?.accent ?? "#fff") + "60" : "rgba(255,255,255,0.08)"}`,
                      color: reviewText.trim() ? activeCat?.accent : "rgba(255,255,255,0.2)",
                      background: reviewText.trim() ? activeCat?.color + "15" : "transparent",
                      borderRadius: "2px",
                    }}
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

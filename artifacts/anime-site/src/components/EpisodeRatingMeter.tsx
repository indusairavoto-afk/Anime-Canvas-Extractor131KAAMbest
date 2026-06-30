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
  { key: "skip"       as VoteCategory, label: "Skip",       zone: "SKIP",       fill: "#dc2626", glow: "#ef4444", text: "#fca5a5" },
  { key: "timepass"   as VoteCategory, label: "Timepass",   zone: "TIMEPASS",   fill: "#ea580c", glow: "#f97316", text: "#fdba74" },
  { key: "go_for_it"  as VoteCategory, label: "Go For It",  zone: "GO FOR IT",  fill: "#ca8a04", glow: "#eab308", text: "#fde047" },
  { key: "perfection" as VoteCategory, label: "Perfection", zone: "PERFECTION", fill: "#16a34a", glow: "#22c55e", text: "#86efac" },
] as const;

const CAT_MAP = Object.fromEntries(CATS.map(c => [c.key, c])) as Record<VoteCategory, typeof CATS[number]>;

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface Props {
  animeId: string;
  episode: number;
  episodeTitle: string;
  onPostReview?: (text: string, category: VoteCategory, spoiler: boolean) => void;
}

/* ── Gauge SVG ─────────────────────────────────────────────────────────── */
const CX = 120, CY = 112, R_OUT = 100, R_IN = 68;
const GAP = 2.2; // degrees of gap between segments

function polar(r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY - r * Math.sin(rad) };
}

function segmentPath(startDeg: number, endDeg: number) {
  const s1 = polar(R_OUT, startDeg - GAP / 2);
  const e1 = polar(R_OUT, endDeg + GAP / 2);
  const s2 = polar(R_IN,  endDeg + GAP / 2);
  const e2 = polar(R_IN,  startDeg - GAP / 2);
  const large = (startDeg - endDeg) > 180 ? 1 : 0;
  return [
    `M ${s1.x} ${s1.y}`,
    `A ${R_OUT} ${R_OUT} 0 ${large} 0 ${e1.x} ${e1.y}`,
    `L ${s2.x} ${s2.y}`,
    `A ${R_IN} ${R_IN} 0 ${large} 1 ${e2.x} ${e2.y}`,
    "Z",
  ].join(" ");
}

// Segments: gauge spans from 180° (left/Skip) to 0° (right/Perfection)
// Each of 4 cats = 45°
const SEGMENTS = CATS.map((cat, i) => ({
  ...cat,
  path: segmentPath(180 - i * 45, 180 - (i + 1) * 45),
  // Center angle for label placement
  labelDeg: 180 - i * 45 - 22.5,
}));

function GaugeMeter({ counts, total, myVote, onVote }: {
  counts: VoteCounts; total: number; myVote: VoteCategory | null;
  onVote?: (cat: VoteCategory) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredSeg, setHoveredSeg] = useState<VoteCategory | null>(null);
  const isDraggingRef = useRef(false);
  const pointerHandledRef = useRef(false);

  // Needle snaps to the segment with the most votes (dominant category).
  // Segment center angles map to needle rotation:
  //   Skip (i=0)       → needleRot = -67.5°
  //   Timepass (i=1)   → needleRot = -22.5°
  //   Go For It (i=2)  → needleRot =  22.5°
  //   Perfection (i=3) → needleRot =  67.5°
  // Formula: (i / 3) * 135 - 67.5
  // No votes → point straight up (0°)
  const activeCat = myVote ? CAT_MAP[myVote] : null;
  const domIdx    = total > 0 ? CATS.reduce((best, _, i) => counts[CATS[i].key] > counts[CATS[best].key] ? i : best, 0) : -1;
  const domCat    = domIdx >= 0 ? CATS[domIdx] : null;
  const domPct    = domCat && total > 0 ? Math.round((counts[domCat.key] / total) * 100) : 0;
  const needleRot = domIdx >= 0 ? (domIdx / (CATS.length - 1)) * 135 - 67.5 : 0;

  // Convert pointer event to gauge segment
  function segFromPointer(e: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>): VoteCategory | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 240;
    const py = ((e.clientY - rect.top) / rect.height) * 140;
    const dx = px - CX;
    const dy = -(py - CY); // invert y (SVG y grows down)
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < R_IN * 0.6 || dist > R_OUT * 1.25) return null;
    if (dy < -8) return null; // below baseline
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    if (angle < 0 || angle > 180) return null;
    if (angle >= 135) return "skip";
    if (angle >= 90)  return "timepass";
    if (angle >= 45)  return "go_for_it";
    return "perfection";
  }

  const displayCat = hoveredSeg ? CAT_MAP[hoveredSeg] : activeCat;

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 240 140"
      className="w-full max-w-[280px]"
      style={{ overflow: "visible", cursor: onVote ? "pointer" : "default", touchAction: "none" }}
      onPointerDown={(e) => {
        if (!onVote) return;
        isDraggingRef.current = true;
        (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
        const seg = segFromPointer(e);
        if (seg) setHoveredSeg(seg);
      }}
      onPointerMove={(e) => {
        if (!onVote) return;
        const seg = segFromPointer(e);
        setHoveredSeg(seg);
      }}
      onPointerUp={(e) => {
        if (!onVote) return;
        const seg = segFromPointer(e);
        if (seg && isDraggingRef.current) {
          pointerHandledRef.current = true;
          onVote(seg);
        }
        isDraggingRef.current = false;
        setHoveredSeg(null);
      }}
      onPointerLeave={() => { isDraggingRef.current = false; setHoveredSeg(null); }}
      onClick={(e) => {
        if (!onVote) return;
        if (pointerHandledRef.current) { pointerHandledRef.current = false; return; }
        const seg = segFromPointer(e);
        if (seg) onVote(seg);
      }}
    >
      <defs>
        {SEGMENTS.map(seg => (
          <filter key={`glow-${seg.key}`} id={`glow-${seg.key}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        ))}
      </defs>

      {/* Segment arcs */}
      {SEGMENTS.map((seg) => {
        const isActive  = myVote === seg.key;
        const isHovered = hoveredSeg === seg.key;
        const isDom     = domCat?.key === seg.key && total > 0;
        const opacity   = isActive ? 1 : isHovered ? 0.85 : isDom ? 0.82 : total > 0 ? 0.25 : 0.18;
        return (
          <path
            key={seg.key}
            d={seg.path}
            fill={seg.fill}
            opacity={opacity}
            filter={(isActive || isHovered || isDom) ? `url(#glow-${seg.key})` : undefined}
            style={{ transition: "opacity 0.3s ease, filter 0.3s ease" }}
          />
        );
      })}

      {/* Zone labels along the arc */}
      {SEGMENTS.map((seg) => {
        const lp = polar(R_OUT + 13, seg.labelDeg);
        const isActive  = myVote === seg.key;
        const isHovered = hoveredSeg === seg.key;
        const isDom     = domCat?.key === seg.key && total > 0;
        return (
          <text
            key={`lbl-${seg.key}`}
            x={lp.x}
            y={lp.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="6.5"
            fontFamily="monospace"
            fontWeight="700"
            letterSpacing="0.8"
            fill={isActive || isHovered || isDom ? seg.text : "rgba(255,255,255,0.28)"}
            style={{
              textTransform: "uppercase",
              transition: "fill 0.2s ease",
              transform: `rotate(${-(seg.labelDeg - 90)}deg)`,
              transformOrigin: `${lp.x}px ${lp.y}px`,
            }}
          >
            {seg.zone}
          </text>
        );
      })}

      {/* "Most Voted" crown badge on the dominant segment */}
      {!hoveredSeg && domCat && total > 0 && (() => {
        const domSeg = SEGMENTS.find(s => s.key === domCat.key)!;
        const bp = polar(R_OUT + 28, domSeg.labelDeg);
        const rot = -(domSeg.labelDeg - 90);
        return (
          <g
            key="most-voted-badge"
            transform={`translate(${bp.x},${bp.y}) rotate(${rot})`}
            style={{ transition: "opacity 0.3s ease" }}
          >
            {/* pill background */}
            <rect x="-12" y="-4.5" width="24" height="9" rx="4.5"
              fill={domCat.fill} opacity="0.55" />
            {/* star + label */}
            <text
              textAnchor="middle" dominantBaseline="middle"
              fontSize="5" fontFamily="monospace" fontWeight="800"
              letterSpacing="0.3" fill={domCat.text}
            >
              ★ MOST
            </text>
          </g>
        );
      })()}

      {/* Center text — reacts to hover */}
      <text
        x={CX} y={CY - 16}
        textAnchor="middle"
        fontSize={hoveredSeg ? "11" : total > 0 ? "28" : "11"}
        fontWeight="800"
        fontFamily="system-ui,sans-serif"
        fill={displayCat?.text ?? (domCat?.text ?? "rgba(255,255,255,0.2)")}
        style={{ transition: "fill 0.2s ease, font-size 0.15s ease" }}
      >
        {hoveredSeg ? CAT_MAP[hoveredSeg].label.toUpperCase() : total > 0 ? `${domPct}%` : "NEXA"}
      </text>
      {!hoveredSeg && total > 0 && (
        <>
          <text x={CX} y={CY - 2} textAnchor="middle" fontSize="7" fontFamily="monospace"
            fill={activeCat?.text ?? (domCat?.text ?? "rgba(255,255,255,0.3)")}
            fontWeight="600" style={{ transition: "fill 0.2s ease" }}>
            {domCat?.zone ?? ""}
          </text>
          <text x={CX} y={CY + 8} textAnchor="middle" fontSize="5.5" fontFamily="monospace"
            fill="rgba(255,255,255,0.2)" letterSpacing="0.5">
            {total.toLocaleString()} VOTES
          </text>
        </>
      )}
      {!hoveredSeg && total === 0 && (
        <text x={CX} y={CY - 2} textAnchor="middle" fontSize="6" fontFamily="monospace"
          fill="rgba(255,255,255,0.15)" letterSpacing="1">
          METER
        </text>
      )}
      {hoveredSeg && (
        <text x={CX} y={CY - 2} textAnchor="middle" fontSize="5.5" fontFamily="monospace"
          fill={CAT_MAP[hoveredSeg].text} letterSpacing="0.8" opacity="0.7">
          TAP TO VOTE
        </text>
      )}

      {/* Needle */}
      <g
        style={{
          transform: `rotate(${needleRot}deg)`,
          transformOrigin: `${CX}px ${CY}px`,
          transition: "transform 0.7s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        {/* Needle shadow/glow */}
        <line
          x1={CX} y1={CY + 8}
          x2={CX} y2={CY - 84}
          stroke={domCat?.glow ?? "rgba(255,255,255,0.15)"}
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.25"
          style={{ transition: "stroke 0.4s ease" }}
        />
        {/* Needle body */}
        <line
          x1={CX} y1={CY + 8}
          x2={CX} y2={CY - 84}
          stroke={domCat?.text ?? "rgba(255,255,255,0.7)"}
          strokeWidth="1.5"
          strokeLinecap="round"
          style={{ transition: "stroke 0.4s ease" }}
        />
        {/* Needle tip triangle */}
        <polygon
          points={`${CX},${CY - 85} ${CX - 2.5},${CY - 76} ${CX + 2.5},${CY - 76}`}
          fill={domCat?.text ?? "rgba(255,255,255,0.8)"}
          style={{ transition: "fill 0.4s ease" }}
        />
      </g>

      {/* Center hub */}
      <circle cx={CX} cy={CY} r="8" fill="#111" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
      <circle cx={CX} cy={CY} r="3.5"
        fill={domCat?.glow ?? "rgba(255,255,255,0.3)"}
        style={{ transition: "fill 0.4s ease" }}
      />

      {/* Baseline */}
      <line x1={CX - R_OUT - 4} y1={CY} x2={CX + R_OUT + 4} y2={CY}
        stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
    </svg>
  );
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
  const activeCat = myVote ? CAT_MAP[myVote] : null;

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
      setMyVote(prev);
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
    try { await fetch(apiUrl(`/api/reviews/${id}/like`), { method: "POST" }); } catch {}
  };

  return (
    <div className="py-8 border-t border-white/[0.05]">

      {/* Header */}
      <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white/20 mb-6">
        Nexa Meter — Episode {episode}
        {episodeTitle && episodeTitle !== `Episode ${episode}` && (
          <span className="text-white/10"> / {episodeTitle}</span>
        )}
      </p>

      {/* Gauge + breakdown */}
      <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start">

        {/* Gauge meter */}
        <div className="shrink-0 w-full sm:w-[220px] flex flex-col items-center">
          <GaugeMeter counts={counts} total={total} myVote={myVote} onVote={castVote} />

          {/* Title below gauge */}
          <p className="text-[8px] font-mono uppercase tracking-[0.3em] text-white/15 mt-1">
            Nexa Rating Meter
          </p>
        </div>

        {/* Vote chips + breakdown bars */}
        <div className="flex-1 min-w-0 w-full space-y-3 pt-1">
          {CATS.map((cat) => {
            const pct   = total > 0 ? Math.round((counts[cat.key] / total) * 100) : 0;
            const isMe  = myVote === cat.key;
            return (
              <div key={cat.key} className="group">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="w-16 text-[9px] font-mono uppercase tracking-wide shrink-0 text-right transition-colors duration-200"
                    style={{ color: isMe ? cat.text : "rgba(255,255,255,0.2)" }}
                  >
                    {cat.label}
                  </span>
                  <div className="flex-1 h-[3px] bg-white/[0.05] rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: cat.glow, opacity: isMe ? 1 : 0.35 }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                    />
                  </div>
                  <span
                    className="w-7 text-[9px] font-mono tabular-nums text-right shrink-0 transition-colors duration-200"
                    style={{ color: isMe ? cat.text : "rgba(255,255,255,0.18)" }}
                  >
                    {pct > 0 ? `${pct}%` : "—"}
                  </span>
                  <span
                    className="text-[8px] font-mono text-right shrink-0 transition-colors duration-200"
                    style={{ color: isMe ? cat.text : "rgba(255,255,255,0.1)", minWidth: 28 }}
                  >
                    {counts[cat.key] > 0 ? counts[cat.key] : ""}
                  </span>
                </div>
              </div>
            );
          })}

          {total > 0 && (
            <p className="text-[8px] font-mono text-white/15 pt-1">
              {total.toLocaleString()} total vote{total !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>

      {/* Vote + Review section */}
      <div className="mt-6 border-t border-white/[0.05] pt-5 space-y-3">
        {reviewPosted ? (
          <div className="flex items-center gap-2 py-2.5 px-3 border border-white/[0.06] bg-white/[0.02]" style={{ borderRadius: "2px" }}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: activeCat?.glow }} />
            <span className="text-[10px] font-mono text-white/30 tracking-wide">Review posted · thanks!</span>
          </div>
        ) : (
          <>
            {/* Vote chips */}
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
                      border: `1px solid ${isMe ? cat.glow + "70" : "rgba(255,255,255,0.07)"}`,
                      background: isMe ? cat.fill + "28" : "rgba(255,255,255,0.03)",
                      color: isMe ? cat.text : "rgba(255,255,255,0.35)",
                      boxShadow: isMe ? `0 0 12px ${cat.glow}30` : "none",
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
                  borderColor: reviewText.trim() ? (activeCat?.fill ?? "") + "45" : undefined,
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
                  border: `1px solid ${myVote && reviewText.trim() ? (activeCat?.glow ?? "#fff") + "60" : "rgba(255,255,255,0.08)"}`,
                  color: myVote && reviewText.trim() ? activeCat?.text : "rgba(255,255,255,0.2)",
                  background: myVote && reviewText.trim() ? (activeCat?.fill ?? "") + "18" : "transparent",
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
              const cat      = CAT_MAP[review.rating];
              const revealed = revealedIds.has(review.id);
              const liked    = likedIds.has(review.id);
              return (
                <motion.div
                  key={review.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3"
                >
                  <div className="w-6 h-6 shrink-0 rounded-full overflow-hidden bg-white/[0.06] mt-0.5">
                    <img src={review.avatarUrl} alt="" className="w-full h-full" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-[10px] font-semibold text-white/60">{review.username}</span>
                      <span
                        className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5"
                        style={{
                          color: cat.text,
                          background: cat.fill + "20",
                          border: `1px solid ${cat.glow}35`,
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

                    <button
                      onClick={() => handleLike(review.id)}
                      className="flex items-center gap-1 transition-colors"
                      style={{ color: liked ? cat.text : "rgba(255,255,255,0.2)" }}
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

import { motion } from "framer-motion";

type VoteCategory = "skip" | "timepass" | "go_for_it" | "perfection";

export type RatingSummary = {
  skip: number;
  timepass: number;
  go_for_it: number;
  perfection: number;
  total: number;
};

const CATS = [
  { key: "skip"       as VoteCategory, label: "Skip",       fill: "#dc2626", glow: "#ef4444", text: "#fca5a5" },
  { key: "timepass"   as VoteCategory, label: "Timepass",   fill: "#ea580c", glow: "#f97316", text: "#fdba74" },
  { key: "go_for_it"  as VoteCategory, label: "Go For It",  fill: "#ca8a04", glow: "#eab308", text: "#fde047" },
  { key: "perfection" as VoteCategory, label: "Perfection", fill: "#16a34a", glow: "#22c55e", text: "#86efac" },
] as const;

/* ── SVG gauge helpers ─────────────────────────────────────────────────── */
const CX = 120, CY = 112, R_OUT = 100, R_IN = 68, GAP = 2.2;

function polar(r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY - r * Math.sin(rad) };
}

function segPath(startDeg: number, endDeg: number) {
  const s1 = polar(R_OUT, startDeg - GAP / 2);
  const e1 = polar(R_OUT, endDeg   + GAP / 2);
  const s2 = polar(R_IN,  endDeg   + GAP / 2);
  const e2 = polar(R_IN,  startDeg - GAP / 2);
  const large = (startDeg - endDeg) > 180 ? 1 : 0;
  return `M ${s1.x} ${s1.y} A ${R_OUT} ${R_OUT} 0 ${large} 0 ${e1.x} ${e1.y} L ${s2.x} ${s2.y} A ${R_IN} ${R_IN} 0 ${large} 1 ${e2.x} ${e2.y} Z`;
}

const SEGMENTS = CATS.map((cat, i) => ({
  ...cat,
  path:     segPath(180 - i * 45, 180 - (i + 1) * 45),
  labelDeg: 180 - i * 45 - 22.5,
}));

/* ── Gauge SVG ─────────────────────────────────────────────────────────── */
function GaugeSvg({ summary }: { summary: RatingSummary }) {
  const { total } = summary;

  const weightedPos = total > 0
    ? CATS.reduce((sum, cat, i) => sum + (i / (CATS.length - 1)) * summary[cat.key], 0) / total
    : -1;

  const needleRot = weightedPos >= 0 ? weightedPos * 180 - 90 : -90;

  const domIdx  = total > 0
    ? CATS.reduce((best, _, i) => summary[CATS[i].key] > summary[CATS[best].key] ? i : best, 0)
    : -1;
  const domCat  = domIdx >= 0 ? CATS[domIdx] : null;
  const domPct  = domCat && total > 0 ? Math.round((summary[domCat.key] / total) * 100) : 0;

  return (
    <svg viewBox="0 0 240 140" className="w-full max-w-[260px]" style={{ overflow: "visible" }}>
      <defs>
        {SEGMENTS.map(seg => (
          <filter key={`gf-${seg.key}`} id={`sgf-${seg.key}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        ))}
      </defs>

      {/* Segment arcs */}
      {SEGMENTS.map((seg) => {
        const isDom = domCat?.key === seg.key && total > 0;
        return (
          <path
            key={seg.key}
            d={seg.path}
            fill={seg.fill}
            opacity={isDom ? 0.85 : total > 0 ? 0.22 : 0.16}
            filter={isDom ? `url(#sgf-${seg.key})` : undefined}
            style={{ transition: "opacity 0.5s ease" }}
          />
        );
      })}

      {/* Zone labels */}
      {SEGMENTS.map((seg) => {
        const lp   = polar(R_OUT + 13, seg.labelDeg);
        const isDom = domCat?.key === seg.key && total > 0;
        return (
          <text
            key={`sl-${seg.key}`}
            x={lp.x} y={lp.y}
            textAnchor="middle" dominantBaseline="middle"
            fontSize="6.5" fontFamily="monospace" fontWeight="700" letterSpacing="0.8"
            fill={isDom ? seg.text : "rgba(255,255,255,0.22)"}
            style={{
              textTransform: "uppercase",
              transition: "fill 0.4s ease",
              transform: `rotate(${-(seg.labelDeg - 90)}deg)`,
              transformOrigin: `${lp.x}px ${lp.y}px`,
            }}
          >
            {seg.label.toUpperCase()}
          </text>
        );
      })}

      {/* Center text */}
      <text x={CX} y={CY - 16} textAnchor="middle"
        fontSize={total > 0 ? "28" : "11"} fontWeight="800" fontFamily="system-ui,sans-serif"
        fill={domCat?.text ?? "rgba(255,255,255,0.18)"}
        style={{ transition: "fill 0.4s ease" }}>
        {total > 0 ? `${domPct}%` : "NEXA"}
      </text>
      {total > 0 && (
        <>
          <text x={CX} y={CY - 2} textAnchor="middle" fontSize="7" fontFamily="monospace"
            fontWeight="700" fill={domCat?.text ?? "rgba(255,255,255,0.3)"}
            style={{ transition: "fill 0.4s ease" }}>
            {domCat?.label.toUpperCase()}
          </text>
          <text x={CX} y={CY + 8} textAnchor="middle" fontSize="5.5" fontFamily="monospace"
            fill="rgba(255,255,255,0.18)" letterSpacing="0.5">
            {total.toLocaleString()} VOTES
          </text>
        </>
      )}
      {total === 0 && (
        <text x={CX} y={CY - 2} textAnchor="middle" fontSize="6" fontFamily="monospace"
          fill="rgba(255,255,255,0.12)" letterSpacing="1">
          METER
        </text>
      )}

      {/* Needle */}
      <g style={{
        transform: `rotate(${needleRot}deg)`,
        transformOrigin: `${CX}px ${CY}px`,
        transition: "transform 0.8s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        <line x1={CX} y1={CY + 8} x2={CX} y2={CY - 84}
          stroke={domCat?.glow ?? "rgba(255,255,255,0.15)"} strokeWidth="3"
          strokeLinecap="round" opacity="0.2"
          style={{ transition: "stroke 0.4s ease" }} />
        <line x1={CX} y1={CY + 8} x2={CX} y2={CY - 84}
          stroke={domCat?.text ?? "rgba(255,255,255,0.6)"} strokeWidth="1.5"
          strokeLinecap="round" style={{ transition: "stroke 0.4s ease" }} />
        <polygon points={`${CX},${CY - 85} ${CX - 2.5},${CY - 76} ${CX + 2.5},${CY - 76}`}
          fill={domCat?.text ?? "rgba(255,255,255,0.7)"}
          style={{ transition: "fill 0.4s ease" }} />
      </g>

      {/* Hub */}
      <circle cx={CX} cy={CY} r="8" fill="#111" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />
      <circle cx={CX} cy={CY} r="3.5" fill={domCat?.glow ?? "rgba(255,255,255,0.25)"}
        style={{ transition: "fill 0.4s ease" }} />

      {/* Baseline */}
      <line x1={CX - R_OUT - 4} y1={CY} x2={CX + R_OUT + 4} y2={CY}
        stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
    </svg>
  );
}

/* ── Public component ──────────────────────────────────────────────────── */
interface Props {
  summary: RatingSummary;
  compact?: boolean;
}

export function SeriesRatingGauge({ summary, compact = false }: Props) {
  const { total } = summary;

  return (
    <div className={`flex ${compact ? "flex-row gap-6 items-center" : "flex-col sm:flex-row gap-6 items-center sm:items-start"}`}>

      {/* Gauge */}
      <div className={`shrink-0 flex flex-col items-center ${compact ? "w-[180px]" : "w-full sm:w-[220px]"}`}>
        <GaugeSvg summary={summary} />
        <p className="text-[8px] font-mono uppercase tracking-[0.3em] text-white/12 -mt-1">
          Nexa Rating Meter
        </p>
      </div>

      {/* Breakdown bars */}
      <div className="flex-1 w-full min-w-0 space-y-2.5">
        {CATS.map((cat) => {
          const pct = total > 0 ? Math.round((summary[cat.key] / total) * 100) : 0;
          const isDom = total > 0 && CATS.reduce((best, _, i) =>
            summary[CATS[i].key] > summary[CATS[best].key] ? i : best, 0) === CATS.indexOf(cat as typeof CATS[number]);
          return (
            <div key={cat.key} className="flex items-center gap-2">
              <span className="w-16 text-[9px] font-mono uppercase tracking-wide shrink-0 text-right transition-colors duration-300"
                style={{ color: isDom ? cat.text : "rgba(255,255,255,0.2)" }}>
                {cat.label}
              </span>
              <div className="flex-1 h-[3px] bg-white/[0.05] rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: cat.glow, opacity: isDom ? 1 : 0.3 }}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1], delay: CATS.indexOf(cat as typeof CATS[number]) * 0.06 }}
                />
              </div>
              <span className="w-7 text-[9px] font-mono tabular-nums text-right shrink-0 transition-colors duration-300"
                style={{ color: isDom ? cat.text : "rgba(255,255,255,0.18)" }}>
                {pct > 0 ? `${pct}%` : "—"}
              </span>
              <span className="text-[8px] font-mono shrink-0 transition-colors duration-300"
                style={{ color: isDom ? cat.text : "rgba(255,255,255,0.1)", minWidth: 26 }}>
                {summary[cat.key] > 0 ? summary[cat.key] : ""}
              </span>
            </div>
          );
        })}
        {total > 0 && (
          <p className="text-[8px] font-mono text-white/15 pt-0.5">
            {total.toLocaleString()} total vote{total !== 1 ? "s" : ""}
          </p>
        )}
      </div>
    </div>
  );
}

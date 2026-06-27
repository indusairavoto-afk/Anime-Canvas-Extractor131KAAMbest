import { useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";

type Category = "skip" | "timepass" | "go_for_it" | "perfection";

const CATS: { key: Category; label: string; short: string; color: string; glow: string }[] = [
  { key: "skip",       label: "Skip",       short: "SKIP", color: "#dc2626", glow: "#ef4444" },
  { key: "timepass",   label: "Timepass",   short: "OK",   color: "#ea580c", glow: "#f97316" },
  { key: "go_for_it",  label: "Go For It",  short: "GOOD", color: "#ca8a04", glow: "#eab308" },
  { key: "perfection", label: "Perfection", short: "PERF", color: "#16a34a", glow: "#22c55e" },
];

interface Summary {
  skip: number; timepass: number; go_for_it: number; perfection: number; total: number;
}

function MiniArc({ domIdx, total }: { domIdx: number; total: number }) {
  const cat = CATS[domIdx];

  const segs = CATS.map((c, i) => {
    const startDeg = 180 - i * 45;
    const endDeg = 180 - (i + 1) * 45;
    const isDom = i === domIdx;

    const toRad = (d: number) => (d * Math.PI) / 180;
    const cx = 20, cy = 18, rOut = 14, rIn = 9;

    const s1x = cx + rOut * Math.cos(toRad(startDeg));
    const s1y = cy - rOut * Math.sin(toRad(startDeg));
    const e1x = cx + rOut * Math.cos(toRad(endDeg));
    const e1y = cy - rOut * Math.sin(toRad(endDeg));
    const s2x = cx + rIn * Math.cos(toRad(endDeg));
    const s2y = cy - rIn * Math.sin(toRad(endDeg));
    const e2x = cx + rIn * Math.cos(toRad(startDeg));
    const e2y = cy - rIn * Math.sin(toRad(startDeg));

    const d = `M ${s1x} ${s1y} A ${rOut} ${rOut} 0 0 0 ${e1x} ${e1y} L ${s2x} ${s2y} A ${rIn} ${rIn} 0 0 1 ${e2x} ${e2y} Z`;

    return { d, fill: c.color, opacity: isDom ? 0.9 : total > 0 ? 0.18 : 0.12, key: c.key };
  });

  const domIdx_ = total > 0 ? domIdx : -1;
  const needlePos = total > 0 ? (domIdx / 3) * 180 - 90 : -90;

  return (
    <svg viewBox="0 0 40 22" width={40} height={22} style={{ overflow: "visible" }}>
      {segs.map(s => (
        <path key={s.key} d={s.d} fill={s.fill} opacity={s.opacity} />
      ))}
      <g style={{ transform: `rotate(${needlePos}deg)`, transformOrigin: "20px 18px", transition: "transform 0.5s ease" }}>
        <line x1="20" y1="20" x2="20" y2="6"
          stroke={domIdx_ >= 0 ? CATS[domIdx_].glow : "rgba(255,255,255,0.4)"}
          strokeWidth="1.2" strokeLinecap="round" opacity="0.9" />
      </g>
      <circle cx="20" cy="18" r="2" fill="#111" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
    </svg>
  );
}

interface Props {
  animeId: number;
  className?: string;
}

export function NexaBadge({ animeId, className = "" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loaded) {
          setLoaded(true);
          fetch(apiUrl(`/api/anime/${animeId}/reviews/summary`))
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) setSummary(d as Summary); })
            .catch(() => {});
        }
      },
      { threshold: 0.1, rootMargin: "100px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [animeId, loaded]);

  if (summary === null || summary.total === 0) {
    return <div ref={ref} className={className} />;
  }

  const domIdx = CATS.reduce((best, _, i) =>
    summary[CATS[i].key] > summary[CATS[best].key] ? i : best, 0);
  const domCat = CATS[domIdx];
  const domPct = Math.round((summary[domCat.key] / summary.total) * 100);

  return (
    <div
      ref={ref}
      className={`flex items-center gap-1 px-1.5 py-0.5 ${className}`}
      style={{
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        border: `1px solid ${domCat.color}30`,
      }}
    >
      <MiniArc domIdx={domIdx} total={summary.total} />
      <div className="flex flex-col leading-none">
        <span className="text-[7px] font-mono font-bold uppercase tracking-widest"
          style={{ color: domCat.glow }}>
          {domCat.short}
        </span>
        <span className="text-[6px] font-mono text-white/40 tabular-nums">
          {domPct}%
        </span>
      </div>
    </div>
  );
}

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, memo } from "react";
import { apiUrl } from "@/lib/api";
import { Link } from "wouter";
import { Clock, Play, Star, Calendar, Loader2, Radio } from "lucide-react";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
type Day = typeof DAYS[number];

interface AiringAnime {
  id: number;
  title: string;
  episode: number;
  day: Day;
  airingAt: number;
  cover: string;
  genres: string[];
  score: number | null;
}

const ANILIST_QUERY = `query {
  Page(perPage: 50) {
    media(
      status: RELEASING
      type: ANIME
      sort: POPULARITY_DESC
      format_in: [TV, TV_SHORT]
    ) {
      id
      title { romaji english }
      coverImage { extraLarge large }
      genres
      averageScore
      nextAiringEpisode { airingAt episode }
    }
  }
}`;

function getDay(ts: number): Day {
  const d = new Date(ts * 1000);
  return DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1];
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return "On Air";
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = secondsLeft % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

type AirStatus = "aired" | "airing" | "upcoming";

function getStatus(airingAt: number, nowMs: number): AirStatus {
  const diff = airingAt - nowMs / 1000;
  if (diff < -3600) return "aired";
  if (diff <= 0) return "airing";
  return "upcoming";
}

const TODAY_INDEX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

/* ── Isolated countdown cell — ticks only itself, not the whole list ── */
const CountdownCell = memo(function CountdownCell({
  airingAt,
}: {
  airingAt: number;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secsLeft = Math.floor(airingAt - now / 1000);
  const status = getStatus(airingAt, now);
  const isAiring = status === "airing";
  const isAired = status === "aired";

  if (isAired) return null;

  return (
    <span
      className={`text-[10px] font-bold font-mono tabular-nums ${
        isAiring ? "text-orange-400" : secsLeft < 3600 ? "text-yellow-400" : "text-white/45"
      }`}
    >
      {formatCountdown(secsLeft)}
    </span>
  );
});

/* ── Episode row — no entrance animation to prevent ghost stacking ── */
const EpisodeRow = memo(function EpisodeRow({
  ep,
  nowMs,
}: {
  ep: AiringAnime;
  index: number;
  nowMs: number;
}) {
  const status = getStatus(ep.airingAt, nowMs);
  const isAiring = status === "airing";
  const isAired = status === "aired";

  return (
    <Link href={`/anime/al/${ep.id}`}>
      <div
        className={`group relative flex items-center gap-3 rounded-xl p-3 border cursor-pointer transition-colors ${
          isAiring
            ? "border-orange-500/30 bg-orange-500/[0.05]"
            : isAired
            ? "border-white/[0.04] bg-white/[0.015] opacity-55"
            : "border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.05] hover:border-white/15"
        }`}
      >
        {/* Airing glow ring */}
        {isAiring && (
          <div
            className="absolute inset-0 rounded-xl pointer-events-none"
            style={{ boxShadow: "inset 0 0 0 1px rgba(249,115,22,0.3)" }}
          />
        )}

        {/* Cover */}
        <div className="relative flex-shrink-0 w-11 h-[66px] rounded-lg overflow-hidden">
          <img
            src={ep.cover}
            alt={ep.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          {isAired && (
            <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
              <span className="text-[7px] font-bold text-white/45 uppercase tracking-widest">Aired</span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {isAiring && (
            <div className="flex items-center gap-1 mb-1">
              <Radio className="w-2.5 h-2.5 text-orange-400 animate-pulse" />
              <span className="text-[9px] font-bold uppercase tracking-widest text-orange-400">
                Live Now
              </span>
            </div>
          )}
          <h3
            className={`font-semibold text-[13px] leading-snug truncate mb-1 ${
              isAired ? "text-white/40" : "text-white"
            }`}
          >
            {ep.title}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-mono text-white/35 uppercase tracking-wider">
              EP {ep.episode}
            </span>
            {ep.score && (
              <span className="flex items-center gap-0.5 text-[9px] font-mono text-yellow-400/65">
                <Star className="w-2 h-2 fill-current" />
                {(ep.score / 10).toFixed(1)}
              </span>
            )}
            {ep.genres.slice(0, 2).map((g) => (
              <span key={g} className="text-[8px] font-mono text-white/20 uppercase tracking-widest">
                {g}
              </span>
            ))}
          </div>
        </div>

        {/* Right: time + live countdown */}
        <div className="flex-shrink-0 flex flex-col items-end gap-1 min-w-[58px]">
          <span className="text-[10px] font-mono text-white/30">{formatTime(ep.airingAt)}</span>
          <CountdownCell airingAt={ep.airingAt} />
          {!isAired && (
            <div className="w-7 h-7 rounded-full border border-white/10 group-hover:border-white/35 flex items-center justify-center text-white/20 group-hover:text-white transition-all mt-0.5">
              <Play className="w-2.5 h-2.5 fill-current" />
            </div>
          )}
        </div>
      </div>
    </Link>
  );
});

export default function Schedule() {
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - TODAY_INDEX);

  const [selectedDay, setSelectedDay] = useState<Day>(DAYS[TODAY_INDEX]);
  const [schedule, setSchedule] = useState<Record<Day, AiringAnime[]>>({
    MON: [], TUE: [], WED: [], THU: [], FRI: [], SAT: [], SUN: [],
  });
  const [loading, setLoading] = useState(true);

  /* Parent only needs minute-level precision for the "X Live" badge */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(apiUrl("/api/anilist"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: ANILIST_QUERY }),
    })
      .then((r) => r.json())
      .then((json) => {
        const media = json?.data?.Page?.media ?? [];
        const grouped: Record<Day, AiringAnime[]> = {
          MON: [], TUE: [], WED: [], THU: [], FRI: [], SAT: [], SUN: [],
        };
        const seenIds = new Set<number>();
        const seenSlots = new Set<string>();
        for (const m of media) {
          if (!m.nextAiringEpisode) continue;
          if (seenIds.has(m.id)) continue;
          const title = (m.title.english || m.title.romaji || "").trim();
          const slotKey = `${title}|${m.nextAiringEpisode.airingAt}`;
          if (seenSlots.has(slotKey)) continue;
          seenIds.add(m.id);
          seenSlots.add(slotKey);
          const day = getDay(m.nextAiringEpisode.airingAt);
          grouped[day].push({
            id: m.id,
            title,
            episode: m.nextAiringEpisode.episode,
            day,
            airingAt: m.nextAiringEpisode.airingAt,
            cover: m.coverImage?.extraLarge || m.coverImage?.large || "",
            genres: m.genres ?? [],
            score: m.averageScore ?? null,
          });
        }
        for (const day of DAYS) {
          grouped[day].sort((a, b) => a.airingAt - b.airingAt);
        }
        setSchedule(grouped);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const episodes = schedule[selectedDay] ?? [];
  const airingNowCount = episodes.filter(
    (e) => getStatus(e.airingAt, nowMs) === "airing"
  ).length;

  return (
    <div className="bg-black text-white min-h-screen pb-24">
      {/* Header */}
      <div className="px-4 pt-6 pb-4 sm:px-8 sm:pt-10">
        <div className="flex items-center gap-3 mb-1">
          <Calendar className="w-5 h-5 text-white/35" />
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Schedule
          </h1>
          {airingNowCount > 0 && (
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-orange-400 bg-orange-500/12 border border-orange-500/25 px-2.5 py-1 rounded-full">
              <Radio className="w-2.5 h-2.5 animate-pulse" />
              {airingNowCount} Live
            </span>
          )}
        </div>
        <p className="text-white/25 text-xs font-mono uppercase tracking-widest ml-8">
          {today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · AniList
        </p>
      </div>

      {/* Day tabs */}
      <div className="border-b border-white/[0.07] overflow-x-auto mb-5">
        <div className="flex min-w-max px-2 sm:px-0 sm:justify-center sm:min-w-0 sm:max-w-3xl sm:mx-auto">
          {DAYS.map((day, i) => {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + i);
            const isToday = i === TODAY_INDEX;
            const isSelected = day === selectedDay;
            const count = schedule[day]?.length ?? 0;
            const hasLive = schedule[day]?.some(
              (e) => getStatus(e.airingAt, nowMs) === "airing"
            );
            return (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                className={`relative flex flex-col items-center pt-3 pb-3.5 px-4 sm:px-7 transition-colors flex-shrink-0 ${
                  isSelected ? "text-white" : "text-white/28 hover:text-white/55"
                }`}
              >
                <span className="text-[9px] font-bold uppercase tracking-widest mb-1 font-mono">
                  {day}
                </span>
                <span className={`text-[17px] font-extrabold leading-none ${isSelected || isToday ? "text-white" : "text-white/30"}`}>
                  {date.getDate()}
                </span>
                <div className="flex items-center gap-1 mt-1">
                  {hasLive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                  )}
                  {count > 0 && (
                    <span className="text-[8px] font-mono text-white/22">{count}</span>
                  )}
                </div>
                {isSelected && (
                  <motion.div
                    layoutId="day-underline"
                    className="absolute bottom-0 left-3 right-3 h-[2px] bg-white rounded-full"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Episode list */}
      <div className="max-w-3xl mx-auto px-3 sm:px-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 className="w-6 h-6 text-white/30 animate-spin" />
            <p className="text-white/30 font-mono text-xs uppercase tracking-widest">
              Fetching schedule…
            </p>
          </div>
        ) : episodes.length === 0 ? (
          <div className="text-center py-24">
            <Calendar className="w-8 h-8 text-white/10 mx-auto mb-4" />
            <p className="text-white/20 font-mono text-sm">No episodes scheduled</p>
          </div>
        ) : (
          <div className="space-y-2">
            {episodes.map((ep, i) => (
              <EpisodeRow key={ep.id} ep={ep} index={i} nowMs={nowMs} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

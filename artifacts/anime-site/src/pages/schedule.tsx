import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef } from "react";
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
  banner: string | null;
  genres: string[];
  score: number | null;
  studio: string | null;
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
      bannerImage
      genres
      averageScore
      studios(isMain: true) { nodes { name } }
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

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return "Now";
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
  const nowS = nowMs / 1000;
  const diff = airingAt - nowS;
  if (diff < -3600) return "aired";
  if (diff <= 0) return "airing";
  return "upcoming";
}

const TODAY_INDEX = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

export default function Schedule() {
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - TODAY_INDEX);

  const [selectedDay, setSelectedDay] = useState<Day>(DAYS[TODAY_INDEX]);
  const [schedule, setSchedule] = useState<Record<Day, AiringAnime[]>>({
    MON: [], TUE: [], WED: [], THU: [], FRI: [], SAT: [], SUN: [],
  });
  const [loading, setLoading] = useState(true);
  const now = useNow(1000);

  useEffect(() => {
    setLoading(true);
    fetch("https://graphql.anilist.co", {
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
        for (const m of media) {
          if (!m.nextAiringEpisode) continue;
          const day = getDay(m.nextAiringEpisode.airingAt);
          grouped[day].push({
            id: m.id,
            title: m.title.english || m.title.romaji,
            episode: m.nextAiringEpisode.episode,
            day,
            airingAt: m.nextAiringEpisode.airingAt,
            cover: m.coverImage?.extraLarge || m.coverImage?.large || "",
            banner: m.bannerImage || null,
            genres: (m.genres ?? []).slice(0, 2),
            score: m.averageScore ?? null,
            studio: m.studios?.nodes?.[0]?.name ?? null,
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
    (e) => getStatus(e.airingAt, now) === "airing"
  ).length;

  return (
    <div className="bg-black text-white min-h-screen pb-24">
      {/* ── Page header ── */}
      <div className="px-4 pt-6 pb-4 sm:px-8 sm:pt-10">
        <div className="flex items-center gap-3 mb-1">
          <Calendar className="w-5 h-5 text-white/40" />
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
        <p className="text-white/30 text-xs font-mono uppercase tracking-widest ml-8">
          {today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · AniList
        </p>
      </div>

      {/* ── Day tabs ── */}
      <div className="border-b border-white/[0.07] overflow-x-auto mb-6">
        <div className="flex min-w-max px-2 sm:px-0 sm:justify-center sm:min-w-0 sm:max-w-3xl sm:mx-auto">
          {DAYS.map((day, i) => {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + i);
            const isToday = i === TODAY_INDEX;
            const isSelected = day === selectedDay;
            const count = schedule[day]?.length ?? 0;
            const hasLive = schedule[day]?.some(
              (e) => getStatus(e.airingAt, now) === "airing"
            );
            return (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                className={`relative flex flex-col items-center pt-3 pb-3.5 px-4 sm:px-7 transition-colors flex-shrink-0 ${
                  isSelected ? "text-white" : "text-white/30 hover:text-white/60"
                }`}
              >
                <span className="text-[9px] font-bold uppercase tracking-widest mb-1 font-mono">
                  {day}
                </span>
                <span
                  className={`text-lg font-extrabold leading-none ${
                    isToday
                      ? "text-white"
                      : isSelected
                      ? "text-white"
                      : "text-white/30"
                  }`}
                >
                  {date.getDate()}
                </span>
                <div className="flex items-center gap-1 mt-1">
                  {hasLive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                  )}
                  {count > 0 && (
                    <span className="text-[8px] font-mono text-white/25">
                      {count}
                    </span>
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

      {/* ── Episode list ── */}
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
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedDay}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="space-y-2"
            >
              {episodes.map((ep, i) => {
                const status = getStatus(ep.airingAt, now);
                const secsLeft = Math.floor(ep.airingAt - now / 1000);
                const isAiring = status === "airing";
                const isAired = status === "aired";

                return (
                  <Link key={ep.id} href={`/anime/al/${ep.id}`}>
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.03, 0.3) }}
                      className={`group relative flex items-center gap-3 rounded-xl p-3 transition-all cursor-pointer border ${
                        isAiring
                          ? "border-orange-500/30 bg-orange-500/[0.05]"
                          : isAired
                          ? "border-white/[0.04] bg-white/[0.02] opacity-60"
                          : "border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.05] hover:border-white/15"
                      }`}
                    >
                      {/* Airing glow */}
                      {isAiring && (
                        <div className="absolute inset-0 rounded-xl pointer-events-none" style={{ boxShadow: "inset 0 0 0 1px rgba(249,115,22,0.25)" }} />
                      )}

                      {/* Cover art */}
                      <div className="relative flex-shrink-0 w-12 h-[72px] rounded-lg overflow-hidden">
                        <img
                          src={ep.cover}
                          alt={ep.title}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          loading="lazy"
                        />
                        {isAired && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <span className="text-[7px] font-bold text-white/50 uppercase tracking-widest">Aired</span>
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          {isAiring && (
                            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-orange-400">
                              <Radio className="w-2.5 h-2.5 animate-pulse" /> Live
                            </span>
                          )}
                        </div>
                        <h3 className={`font-semibold text-[13px] leading-snug truncate mb-1 ${isAired ? "text-white/45" : "text-white"}`}>
                          {ep.title}
                        </h3>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[9px] font-mono text-white/40 uppercase tracking-wider">
                            EP {ep.episode}
                          </span>
                          {ep.score && (
                            <span className="flex items-center gap-0.5 text-[9px] font-mono text-yellow-400/70">
                              <Star className="w-2 h-2 fill-current" />
                              {(ep.score / 10).toFixed(1)}
                            </span>
                          )}
                          {ep.genres.map((g) => (
                            <span key={g} className="text-[8px] font-mono text-white/20 uppercase tracking-widest">
                              {g}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Right: time + countdown */}
                      <div className="flex-shrink-0 flex flex-col items-end gap-1 min-w-[60px]">
                        <span className="text-[10px] font-mono text-white/30">{formatTime(ep.airingAt)}</span>
                        {!isAired && (
                          <span
                            className={`text-[10px] font-bold font-mono tabular-nums ${
                              isAiring ? "text-orange-400" : secsLeft < 3600 ? "text-yellow-400" : "text-white/50"
                            }`}
                          >
                            {isAiring ? "On Air" : formatCountdown(secsLeft)}
                          </span>
                        )}
                        {!isAired && (
                          <div className="w-8 h-8 rounded-full border border-white/10 group-hover:border-white/35 flex items-center justify-center text-white/20 group-hover:text-white transition-all mt-0.5">
                            <Play className="w-3 h-3 fill-current" />
                          </div>
                        )}
                      </div>
                    </motion.div>
                  </Link>
                );
              })}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

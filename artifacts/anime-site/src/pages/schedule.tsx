import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Clock, Play, Star, Tv, Calendar, Loader2 } from "lucide-react";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
type Day = typeof DAYS[number];

interface AiringAnime {
  id: number;
  title: string;
  episode: number;
  day: Day;
  airingAt: number;
  timeJST: string;
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
  const [hoveredId, setHoveredId] = useState<number | null>(null);

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
            timeJST: formatTime(m.nextAiringEpisode.airingAt),
            cover: m.coverImage?.extraLarge || m.coverImage?.large || "",
            banner: m.bannerImage || null,
            genres: (m.genres ?? []).slice(0, 3),
            score: m.averageScore ?? null,
            studio: m.studios?.nodes?.[0]?.name ?? null,
          });
        }
        // Sort each day by airing time
        for (const day of DAYS) {
          grouped[day].sort((a, b) => a.airingAt - b.airingAt);
        }
        setSchedule(grouped);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const episodes = schedule[selectedDay] ?? [];
  const hovered = episodes.find((e) => e.id === hoveredId);

  return (
    <div className="bg-black text-white min-h-screen">
      {/* Hero banner - shows hovered anime banner */}
      <div className="relative h-48 sm:h-64 overflow-hidden">
        <AnimatePresence>
          {hovered?.banner ? (
            <motion.img
              key={hovered.id}
              src={hovered.banner}
              alt={hovered.title}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ filter: "brightness(0.25) saturate(1.2)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            />
          ) : (
            <div key="default" className="absolute inset-0 bg-zinc-950" />
          )}
        </AnimatePresence>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent" />

        <div className="absolute bottom-6 sm:bottom-8 left-4 sm:left-8 lg:left-16 right-4">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-serif text-4xl sm:text-5xl text-white mb-1"
          >
            Weekly Schedule
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-white/30 font-mono text-xs uppercase tracking-widest"
          >
            {today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            {" · "}
            Live from AniList
          </motion.p>
        </div>
      </div>

      {/* Day tabs */}
      <div className="border-y border-white/5 overflow-x-auto">
        <div className="flex min-w-max mx-auto px-4 sm:px-0 sm:min-w-0 sm:max-w-4xl sm:justify-center">
          {DAYS.map((day, i) => {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + i);
            const isToday = i === TODAY_INDEX;
            const isSelected = day === selectedDay;
            const count = schedule[day]?.length ?? 0;
            return (
              <button
                key={day}
                onClick={() => { setSelectedDay(day); setHoveredId(null); }}
                className={`relative flex flex-col items-center py-3 sm:py-4 px-4 sm:px-7 transition-colors flex-shrink-0 ${
                  isSelected ? "text-white" : "text-white/30 hover:text-white/60"
                }`}
              >
                <span className="text-[10px] font-mono uppercase tracking-widest mb-1">{day}</span>
                <span className={`text-lg sm:text-xl font-serif ${isToday ? "text-white" : ""}`}>
                  {date.getDate()}
                </span>
                <div className="flex items-center gap-1 mt-0.5">
                  {isToday && <span className="text-[8px] font-mono text-white/40 uppercase">Today</span>}
                  {count > 0 && (
                    <span className={`text-[8px] font-mono uppercase ${isToday ? "text-white/30" : "text-white/20"}`}>
                      {count}
                    </span>
                  )}
                </div>
                {isSelected && <div className="absolute bottom-0 left-0 right-0 h-px bg-white" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Schedule list */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 className="w-6 h-6 text-white/30 animate-spin" />
            <p className="text-white/30 font-mono text-xs uppercase tracking-widest">Fetching live schedule…</p>
          </div>
        ) : episodes.length === 0 ? (
          <div className="text-center py-24">
            <Calendar className="w-8 h-8 text-white/10 mx-auto mb-4" />
            <p className="text-white/20 font-mono text-sm">No episodes scheduled</p>
          </div>
        ) : (
          <motion.div
            key={selectedDay}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            {episodes.map((ep, i) => (
              <Link key={ep.id} href={`/watch/al/${ep.id}/1`}>
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onMouseEnter={() => setHoveredId(ep.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className="group flex items-center gap-3 sm:gap-5 border border-white/5 hover:border-white/20 bg-zinc-950/40 hover:bg-white/[0.03] transition-all p-3 sm:p-4 cursor-pointer"
                >
                  {/* Time */}
                  <div className="text-right flex-shrink-0 w-16 sm:w-20">
                    <div className="flex items-center gap-1 text-white/40 justify-end">
                      <Clock className="w-3 h-3 flex-shrink-0" />
                      <span className="text-[10px] sm:text-xs font-mono">{ep.timeJST}</span>
                    </div>
                  </div>

                  <div className="w-px h-12 bg-white/8 flex-shrink-0 hidden sm:block" />

                  {/* Cover */}
                  <div className="relative flex-shrink-0 overflow-hidden w-12 sm:w-16 rounded-sm">
                    <img
                      src={ep.cover}
                      alt={ep.title}
                      className="w-full aspect-[2/3] object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-serif text-sm sm:text-base leading-snug mb-1 truncate group-hover:text-white transition-colors">
                      {ep.title}
                    </h3>
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                      <span className="text-[9px] font-mono text-white/50 uppercase tracking-widest">
                        EP {ep.episode}
                      </span>
                      {ep.score && (
                        <span className="flex items-center gap-0.5 text-[9px] font-mono text-white/40">
                          <Star className="w-2.5 h-2.5" />
                          {(ep.score / 10).toFixed(1)}
                        </span>
                      )}
                      {ep.studio && (
                        <span className="hidden sm:inline text-[9px] font-mono text-white/25 uppercase tracking-widest truncate max-w-[120px]">
                          {ep.studio}
                        </span>
                      )}
                      <div className="flex gap-1 flex-wrap">
                        {ep.genres.map((g) => (
                          <span
                            key={g}
                            className="text-[8px] font-mono uppercase tracking-widest border border-white/8 px-1.5 py-0.5 text-white/25"
                          >
                            {g}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Play icon */}
                  <div className="flex-shrink-0 w-9 h-9 sm:w-10 sm:h-10 border border-white/8 group-hover:border-white/40 flex items-center justify-center text-white/20 group-hover:text-white transition-all">
                    <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current" />
                  </div>
                </motion.div>
              </Link>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}

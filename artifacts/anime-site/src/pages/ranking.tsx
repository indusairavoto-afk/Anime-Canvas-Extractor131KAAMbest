import { useState, useEffect } from "react";
import { apiUrl } from "@/lib/api";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Star, Play, TrendingUp, Trophy, Calendar } from "lucide-react";

type Period = "DAY" | "WEEK" | "MONTH";

interface AniMedia {
  id: number;
  title: { romaji: string; english?: string | null };
  coverImage: { extraLarge?: string; large?: string };
  bannerImage?: string | null;
  averageScore?: number | null;
  status: string;
  seasonYear?: number | null;
  format?: string | null;
  episodes?: number | null;
  genres?: string[];
  popularity?: number | null;
}

function buildRankingQuery(period: Period) {
  const sortMap = { DAY: "TRENDING_DESC", WEEK: "POPULARITY_DESC", MONTH: "SCORE_DESC" };
  const extra =
    period === "DAY" ? "status: RELEASING" :
    period === "WEEK" ? "status: RELEASING" :
    "format: TV";
  return `{
  Page(perPage: 50) {
    media(
      type: ANIME
      sort: ${sortMap[period]}
      ${extra}
      isAdult: false
    ) {
      id
      title { romaji english }
      coverImage { extraLarge large }
      bannerImage
      averageScore
      status
      seasonYear
      format
      episodes
      genres
      popularity
    }
  }
}`;
}

async function fetchAniList(query: string): Promise<AniMedia[]> {
  const res = await fetch(apiUrl("/api/anilist"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  return json?.data?.Page?.media ?? [];
}

const PERIOD_LABELS: Record<Period, { label: string; sub: string; icon: React.ReactNode }> = {
  DAY: { label: "Today", sub: "Currently trending", icon: <TrendingUp className="w-4 h-4" /> },
  WEEK: { label: "This Week", sub: "Most popular airing", icon: <Calendar className="w-4 h-4" /> },
  MONTH: { label: "All Time", sub: "Highest rated TV", icon: <Trophy className="w-4 h-4" /> },
};

function RankRow({ anime, rank, index }: { anime: AniMedia; rank: number; index: number }) {
  const cover = anime.coverImage?.extraLarge || anime.coverImage?.large || "";
  const title = anime.title.english || anime.title.romaji;
  const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;

  const rankColor =
    rank === 1 ? "text-yellow-400" :
    rank === 2 ? "text-zinc-300" :
    rank === 3 ? "text-amber-600" :
    "text-white/20";

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.03, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link href={`/anime/al/${anime.id}`}>
        <div className="group flex items-center gap-4 px-4 sm:px-6 py-3 hover:bg-white/[0.03] border-b border-white/5 transition-colors cursor-pointer">
          {/* Rank */}
          <div className="w-8 shrink-0 text-right">
            <span className={`font-black text-lg leading-none ${rankColor}`}>
              {rank <= 3 ? (
                <span className="text-base">{rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉"}</span>
              ) : (
                <span className="font-mono text-sm text-white/25">{rank}</span>
              )}
            </span>
          </div>

          {/* Cover */}
          <div className="relative w-10 aspect-[2/3] shrink-0 overflow-hidden bg-zinc-900">
            <img
              src={cover}
              alt={title}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
              loading="lazy"
            />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white/90 group-hover:text-white font-medium truncate transition-colors leading-snug">
              {title}
            </p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {anime.format && (
                <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">{anime.format}</span>
              )}
              {anime.seasonYear && (
                <span className="text-[9px] font-mono text-white/20">{anime.seasonYear}</span>
              )}
              {anime.genres?.slice(0, 2).map(g => (
                <span key={g} className="text-[9px] font-mono text-white/20 uppercase tracking-widest">{g}</span>
              ))}
            </div>
          </div>

          {/* Score */}
          <div className="shrink-0 flex items-center gap-1">
            {score ? (
              <>
                <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                <span className="text-xs font-mono text-white/70">{score}</span>
              </>
            ) : (
              <span className="text-xs font-mono text-white/20">—</span>
            )}
          </div>

          {/* Episodes */}
          {anime.episodes && (
            <div className="shrink-0 hidden sm:block">
              <span className="text-[10px] font-mono text-white/20">{anime.episodes} ep</span>
            </div>
          )}

          {/* Play icon on hover */}
          <div className="shrink-0 w-6 h-6 rounded-full bg-white/0 group-hover:bg-white/10 flex items-center justify-center transition-colors border border-white/0 group-hover:border-white/20">
            <Play className="w-2.5 h-2.5 fill-white text-white opacity-0 group-hover:opacity-100 transition-opacity ml-0.5" />
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

export default function Ranking() {
  const [period, setPeriod] = useState<Period>("DAY");
  const [anime, setAnime] = useState<AniMedia[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setAnime([]);
    fetchAniList(buildRankingQuery(period)).then((data) => {
      setAnime(data);
      setLoading(false);
    });
  }, [period]);

  const { label, sub, icon } = PERIOD_LABELS[period];

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-white/5 bg-black/80 backdrop-blur-sm sticky top-14 z-10">
        <div className="px-4 sm:px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center border border-white/10 text-white/50">
              {icon}
            </div>
            <div>
              <p className="text-[9px] font-mono text-white/30 uppercase tracking-[0.3em]">Rankings</p>
              <h1 className="font-serif text-xl text-white leading-none">Top 50 — {label}</h1>
            </div>
          </div>

          {/* Period tabs */}
          <div className="flex items-center gap-0.5">
            {(["DAY", "WEEK", "MONTH"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-[9px] font-mono uppercase tracking-widest transition-colors border ${
                  period === p
                    ? "bg-white text-black border-white"
                    : "text-white/35 border-white/10 hover:text-white hover:border-white/30"
                }`}
              >
                {PERIOD_LABELS[p].label}
              </button>
            ))}
          </div>
        </div>

        {/* Sub-label */}
        <div className="px-4 sm:px-6 pb-3">
          <p className="text-[10px] font-mono text-white/25 uppercase tracking-widest">{sub}</p>
        </div>
      </div>

      {/* List */}
      <div className="pb-16">
        {loading ? (
          Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 sm:px-6 py-3 border-b border-white/5">
              <div className="w-8 shrink-0" />
              <div className="w-10 aspect-[2/3] shrink-0 bg-zinc-900 animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-zinc-900 animate-pulse rounded w-2/3" />
                <div className="h-2 bg-zinc-900/60 animate-pulse rounded w-1/3" />
              </div>
            </div>
          ))
        ) : (
          anime.map((a, i) => (
            <RankRow key={a.id} anime={a} rank={i + 1} index={i} />
          ))
        )}
      </div>
    </div>
  );
}

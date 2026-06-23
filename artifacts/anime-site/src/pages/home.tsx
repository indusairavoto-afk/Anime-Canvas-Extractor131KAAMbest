import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import { Play, Star, Clock, ChevronRight, TrendingUp, ChevronLeft, X, History, CalendarClock, Info } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { AnimeCardSkeleton } from "@/components/anime-card";
import { useContinueWatching, type ContinueWatchingEntry } from "@/hooks/useContinueWatching";

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } };

type TrendingPeriod = "DAY" | "WEEK" | "MONTH";

interface AniMedia {
  id: number;
  title: { romaji: string; english?: string | null };
  description?: string | null;
  coverImage: { extraLarge?: string; large?: string };
  bannerImage?: string | null;
  genres: string[];
  averageScore?: number | null;
  status: string;
  seasonYear?: number | null;
  format?: string | null;
  episodes?: number | null;
  duration?: number | null;
  season?: string | null;
  studios?: { nodes: { name: string }[] };
  nextAiringEpisode?: { episode: number; timeUntilAiring: number } | null;
}

const HERO_QUERY = `{
  Page(perPage: 20) {
    media(
      type: ANIME
      sort: TRENDING_DESC
      status: RELEASING
      format: TV
      isAdult: false
    ) {
      id
      title { romaji english }
      description(asHtml: false)
      coverImage { extraLarge large }
      bannerImage
      genres
      averageScore
      status
      seasonYear
      format
      episodes
      duration
      studios(isMain: true) { nodes { name } }
      nextAiringEpisode { episode timeUntilAiring }
    }
  }
}`;

const POPULAR_QUERY = `{
  Page(perPage: 20) {
    media(
      type: ANIME
      sort: POPULARITY_DESC
      isAdult: false
    ) {
      id
      title { romaji english }
      coverImage { extraLarge large }
      averageScore
      status
      seasonYear
      format
    }
  }
}`;

function buildTop10Query(period: "DAY" | "WEEK" | "MONTH") {
  const sortMap = {
    DAY: "TRENDING_DESC",
    WEEK: "POPULARITY_DESC",
    MONTH: "SCORE_DESC",
  };
  const extra = period === "DAY"
    ? "status: RELEASING"
    : period === "WEEK"
    ? "status: RELEASING"
    : "format: TV";
  return `{
  Page(perPage: 10) {
    media(
      type: ANIME
      sort: ${sortMap[period]}
      ${extra}
      isAdult: false
    ) {
      id
      title { romaji english }
      coverImage { extraLarge large }
      averageScore
      status
      seasonYear
      format
    }
  }
}`;
}

function getCurrentSeason(): { season: string; year: number } {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const season = month <= 3 ? "WINTER" : month <= 6 ? "SPRING" : month <= 9 ? "SUMMER" : "FALL";
  return { season, year };
}

function buildSeasonQuery(season: string, year: number) {
  return `{
  Page(perPage: 30) {
    media(
      type: ANIME
      season: ${season}
      seasonYear: ${year}
      sort: POPULARITY_DESC
      isAdult: false
      format_in: [TV, TV_SHORT, ONA]
    ) {
      id
      title { romaji english }
      coverImage { extraLarge large }
      averageScore
      status
      seasonYear
      season
      format
      episodes
    }
  }
}`;
}

const UPCOMING_QUERY = `{
  Page(perPage: 20) {
    media(
      type: ANIME
      status: NOT_YET_RELEASED
      sort: POPULARITY_DESC
      isAdult: false
      format_in: [TV, TV_SHORT, ONA]
    ) {
      id
      title { romaji english }
      coverImage { extraLarge large }
      bannerImage
      averageScore
      status
      seasonYear
      season
      format
      episodes
      startDate { year month day }
      genres
      studios(isMain: true) { nodes { name } }
    }
  }
}`;

interface AiringEpisodeEntry {
  id: string;
  animeId: number;
  animeTitle: string;
  episodeNumber: number;
  episodeTitle: string;
  thumbnail: string;   // episode-specific thumbnail from streamingEpisodes if available
  cover: string;       // anime cover image fallback
  banner: string;      // anime banner fallback
  score: number | null;
  format: string | null;
  genres: string[];
  studio: string;
  airingAt: number;    // unix timestamp
  totalEpisodes: number | null;
}

const AIRING_QUERY = (airedBefore: number, airedAfter: number) => `{
  Page(perPage: 30) {
    airingSchedules(
      airingAt_lesser: ${airedBefore}
      airingAt_greater: ${airedAfter}
      notYetAired: false
      sort: TIME_DESC
    ) {
      id
      episode
      airingAt
      media {
        id
        title { romaji english }
        coverImage { extraLarge large }
        bannerImage
        averageScore
        genres
        format
        episodes
        isAdult
        streamingEpisodes {
          title
          thumbnail
          site
        }
        studios(isMain: true) { nodes { name } }
      }
    }
  }
}`;

async function fetchRecentAiring(): Promise<AiringEpisodeEntry[]> {
  const now = Math.floor(Date.now() / 1000);
  const weekAgo = now - 7 * 24 * 3600;
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: AIRING_QUERY(now, weekAgo) }),
  });
  const json = await res.json();
  const schedules: Array<{
    id: number;
    episode: number;
    airingAt: number;
    media: {
      id: number;
      title: { romaji: string; english?: string | null };
      coverImage: { extraLarge?: string; large?: string };
      bannerImage?: string | null;
      averageScore?: number | null;
      genres: string[];
      format?: string | null;
      episodes?: number | null;
      isAdult?: boolean;
      streamingEpisodes?: { title: string; thumbnail: string; site: string }[];
      studios?: { nodes: { name: string }[] };
    };
  }> = json?.data?.Page?.airingSchedules ?? [];

  const seen = new Set<string>();
  const entries: AiringEpisodeEntry[] = [];

  for (const s of schedules) {
    const m = s.media;
    if (m.isAdult) continue;
    const key = `${m.id}-${s.episode}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Try to find an episode-specific thumbnail from streamingEpisodes
    // streamingEpisodes titles often contain the episode number: "Episode 1 - Title"
    let thumbnail = "";
    let episodeTitle = `Episode ${s.episode}`;
    if (m.streamingEpisodes?.length) {
      const epRe = new RegExp(`episode\\s*${s.episode}\\b`, "i");
      const match = m.streamingEpisodes.find((se) => epRe.test(se.title ?? ""));
      if (match) {
        thumbnail = match.thumbnail ?? "";
        // Extract title after the dash if present: "Episode 1 - The Beginning" → "The Beginning"
        const dashIdx = (match.title ?? "").indexOf(" - ");
        if (dashIdx > -1) episodeTitle = match.title.slice(dashIdx + 3).trim();
      }
    }

    const cover = m.coverImage?.extraLarge || m.coverImage?.large || "";
    const banner = m.bannerImage || cover;
    entries.push({
      id: key,
      animeId: m.id,
      animeTitle: m.title.english || m.title.romaji,
      episodeNumber: s.episode,
      episodeTitle,
      thumbnail: thumbnail || banner || cover,
      cover,
      banner,
      score: m.averageScore ? m.averageScore / 10 : null,
      format: m.format ?? null,
      genres: m.genres?.slice(0, 2) ?? [],
      studio: m.studios?.nodes?.[0]?.name ?? "",
      airingAt: s.airingAt,
      totalEpisodes: m.episodes ?? null,
    });
  }
  return entries;
}

function timeAgo(unix: number): string {
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
}

async function fetchAniList(query: string): Promise<AniMedia[]> {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  return json?.data?.Page?.media ?? [];
}

function HeroSlide({ anime }: { anime: AniMedia }) {
  return (
    <motion.div
      key={anime.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.7, ease: "easeInOut" }}
      className="absolute inset-0"
    >
      <img
        src={anime.bannerImage!}
        alt={anime.title.english || anime.title.romaji}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ filter: "brightness(0.62) contrast(1.05)" }}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/30 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black to-transparent" />
    </motion.div>
  );
}

/* ── Mobile hero: split layout — cover art right, info left ── */
function MobileHeroCard({ anime, direction, dots }: { anime: AniMedia; direction: number; dots: React.ReactNode }) {
  const title = anime.title.english || anime.title.romaji;
  const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
  const cover = anime.coverImage?.extraLarge || anime.coverImage?.large || "";
  const banner = anime.bannerImage || cover;

  let currentEp: number | null = null;
  let airingLabel: string | null = null;
  if (anime.nextAiringEpisode) {
    const { episode, timeUntilAiring } = anime.nextAiringEpisode;
    currentEp = episode - 1;
    const days = Math.floor(timeUntilAiring / 86400);
    const hours = Math.floor((timeUntilAiring % 86400) / 3600);
    airingLabel = `EP ${episode} in ${days > 0 ? `${days}d ` : ""}${hours}h`;
  }

  return (
    <AnimatePresence mode="wait" custom={direction}>
      <motion.div
        key={anime.id}
        custom={direction}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.38 }}
        className="absolute inset-0 overflow-hidden bg-black"
      >
        {/* Full-bleed banner — sharp, top-anchored */}
        <img
          src={banner}
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-top"
          style={{ filter: "brightness(0.78) saturate(1.1)" }}
        />

        {/* Strong gradient from transparent → black at bottom */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.12) 35%, rgba(0,0,0,0.72) 62%, rgba(0,0,0,0.97) 80%, #000 100%)",
          }}
        />

        {/* Side vignettes so nothing bleeds to edges */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to right, rgba(0,0,0,0.35) 0%, transparent 20%, transparent 80%, rgba(0,0,0,0.35) 100%)" }} />

        {/* ── Bottom content panel ── */}
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-5">

          {/* Trending pill */}
          <div className="mb-2.5">
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-orange-400 bg-orange-500/15 border border-orange-500/30 px-2.5 py-1 rounded-full">
              Trending
            </span>
          </div>

          {/* Title */}
          <h1 className="font-extrabold text-[26px] leading-[1.05] text-white mb-2.5 drop-shadow-lg" style={{ letterSpacing: "-0.3px" }}>
            {title}
          </h1>

          {/* Meta row: score · format · year · airing */}
          <div className="flex items-center gap-2.5 mb-3 flex-wrap">
            {score && (
              <span className="flex items-center gap-1 text-[12px] font-bold text-yellow-400">
                <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" /> {score}
              </span>
            )}
            {anime.format && (
              <span className="text-[10px] font-bold text-white/45 uppercase tracking-wider">
                {anime.format}
              </span>
            )}
            {anime.seasonYear && (
              <span className="text-[10px] text-white/35">{anime.seasonYear}</span>
            )}
            {airingLabel && (
              <span className="flex items-center gap-1 text-[10px] text-white/45">
                <Clock className="w-2.5 h-2.5" /> {airingLabel}
              </span>
            )}
          </div>

          {/* Genre pills */}
          {anime.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {anime.genres.slice(0, 3).map((g) => (
                <span key={g} className="text-[10px] text-white/55 px-2.5 py-0.5 rounded-full border border-white/14 bg-white/[0.06]">
                  {g}
                </span>
              ))}
            </div>
          )}

          {/* CTA row */}
          <div className="flex gap-2.5 items-center">
            <Link href={`/watch/al/${anime.id}/${currentEp ?? 1}`} className="flex-1">
              <button className="w-full flex items-center justify-center gap-2 bg-white text-black py-3 rounded-xl text-[13px] font-extrabold active:scale-95 transition-transform tracking-wide">
                <Play className="w-4 h-4 fill-black" /> WATCH
              </button>
            </Link>
            <Link href={`/anime/al/${anime.id}`}>
              <button className="flex items-center justify-center w-12 h-12 rounded-xl bg-white/10 text-white border border-white/18 active:bg-white/20 transition-colors">
                <Info className="w-5 h-5" />
              </button>
            </Link>
          </div>

          {/* Slide dots */}
          <div className="flex items-center gap-1.5 mt-4">
            {dots}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function HeroText({ anime, direction }: { anime: AniMedia; direction: number }) {
  const title = anime.title.english || anime.title.romaji;
  const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
  const desc = anime.description ? stripHtml(anime.description) : "";
  return (
    <AnimatePresence mode="wait" custom={direction}>
      <motion.div
        key={anime.id}
        custom={direction}
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -14 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-xl"
      >
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {score && (
            <span className="flex items-center gap-1 text-[11px] font-bold text-yellow-400">
              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />{score}
            </span>
          )}
          {anime.format && (
            <span className="text-[10px] font-mono bg-white/15 text-white/80 px-1.5 py-0.5 uppercase tracking-wider">
              {anime.format}
            </span>
          )}
          {anime.seasonYear && (
            <span className="text-[11px] font-mono text-white/50 uppercase tracking-wider">{anime.seasonYear}</span>
          )}
          <span className="text-[9px] font-mono bg-white text-black px-2 py-0.5 uppercase tracking-wider font-bold">Trending</span>
        </div>
        <h1 className="font-serif text-5xl lg:text-6xl leading-[0.95] text-white mb-3 line-clamp-2">
          {title}
        </h1>
        <p className="text-white/55 text-sm leading-relaxed mb-6 line-clamp-2 max-w-sm sm:max-w-md">
          {desc.slice(0, 200)}
        </p>
        <div className="flex gap-3">
          <Link href={`/anime/al/${anime.id}`}>
            <button className="flex items-center gap-2 bg-white text-black px-7 py-3 text-sm font-bold uppercase tracking-widest hover:bg-white/90 transition-colors">
              <Play className="w-3.5 h-3.5 fill-black" /> Details
            </button>
          </Link>
          {anime.genres.slice(0, 2).map((g) => (
            <Link key={g} href={`/browse?genre=${encodeURIComponent(g)}`}>
              <button className="flex items-center gap-1.5 border border-white/25 text-white px-5 py-3 text-sm font-medium uppercase tracking-widest hover:bg-white/5 transition-colors">
                {g}
              </button>
            </Link>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function ContinueWatchingCard({ entry, onRemove }: { entry: ContinueWatchingEntry; onRemove: () => void }) {
  const progress = entry.totalEpisodes ? Math.min(100, (entry.episodeNumber / entry.totalEpisodes) * 100) : 0;
  return (
    <motion.div variants={fadeUp} className="relative group flex-shrink-0 w-36 sm:w-44">
      <Link href={`/watch/al/${entry.animeId}/${entry.episodeNumber}`}>
        <div className="cursor-pointer border border-white/5 hover:border-white/25 transition-all overflow-hidden">
          <div className="relative aspect-[2/3] overflow-hidden bg-zinc-900">
            <img
              src={entry.cover}
              alt={entry.title}
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
            {/* Play icon on hover */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center">
                <Play className="w-4 h-4 text-white fill-white ml-0.5" />
              </div>
            </div>
            {/* Episode badge */}
            <div className="absolute bottom-0 left-0 right-0 p-2.5">
              <div className="text-[9px] font-mono text-orange-400 uppercase tracking-widest mb-1">
                EP {entry.episodeNumber}{entry.totalEpisodes ? ` / ${entry.totalEpisodes}` : ""}
              </div>
              {/* Progress bar */}
              {entry.totalEpisodes && entry.totalEpisodes > 1 && (
                <div className="h-0.5 w-full bg-white/15 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-orange-500 rounded-full transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>
          </div>
          <div className="px-2 py-2">
            <p className="text-white text-[11px] font-medium line-clamp-2 leading-snug">{entry.title}</p>
          </div>
        </div>
      </Link>
      {/* Remove button */}
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
        className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/70 border border-white/20 text-white/50 hover:text-white hover:border-white/60 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100 z-10"
        title="Remove from continue watching"
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </motion.div>
  );
}

function Top10Card({ anime, rank, index }: { anime: AniMedia; rank: number; index: number }) {
  const cover = anime.coverImage?.extraLarge || anime.coverImage?.large || "";
  const title = anime.title.english || anime.title.romaji;
  const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="flex-shrink-0 flex items-end group"
      style={{ width: 155 }}
    >
      {/* Rank number — bottom-left, card overlaps it */}
      <div
        className="flex-shrink-0 select-none pointer-events-none self-end pb-1"
        style={{ width: 44 }}
      >
        <span
          className="font-black block text-right leading-none"
          style={{
            fontSize: 86,
            WebkitTextStroke: "2px rgba(255,255,255,0.28)",
            color: "transparent",
          }}
        >
          {rank}
        </span>
      </div>
      {/* Poster — overlaps number with negative margin */}
      <Link href={`/anime/al/${anime.id}`} className="block flex-1 -ml-3">
        <div className="relative aspect-[2/3] bg-zinc-900 overflow-hidden">
          <img
            src={cover}
            alt={title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
          {score && (
            <div className="absolute top-2 right-2 flex items-center gap-0.5 bg-black/70 backdrop-blur-sm px-1.5 py-0.5 border border-white/10">
              <Star className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400" />
              <span className="text-[9px] font-mono text-white/90">{score}</span>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 p-2.5 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
            <p className="text-white text-[11px] font-medium line-clamp-2 leading-snug mb-1.5">{title}</p>
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-full bg-white/15 border border-white/25 flex items-center justify-center">
                <Play className="w-3 h-3 fill-white text-white ml-0.5" />
              </div>
              {anime.format && <span className="text-[8px] font-mono text-white/40 uppercase tracking-wider">{anime.format}</span>}
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function UpcomingCard({ anime, index }: { anime: AniMedia; index: number }) {
  const cover = anime.coverImage?.extraLarge || anime.coverImage?.large || "";
  const title = anime.title.english || anime.title.romaji;
  const season = anime.season ? anime.season.charAt(0) + anime.season.slice(1).toLowerCase() : null;
  const year = anime.seasonYear;
  const airLabel = season && year ? `${season} ${year}` : year ? String(year) : "Coming Soon";
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link href={`/anime/al/${anime.id}`}>
        <div className="group relative cursor-pointer">
          <div className="relative w-full aspect-[2/3] border border-white/5 bg-zinc-950 overflow-hidden">
            <img
              src={cover}
              alt={title}
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />
            {/* Upcoming badge */}
            <div className="absolute top-2 left-2">
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-violet-600/90 text-white text-[8px] font-mono uppercase tracking-widest border border-violet-400/30">
                <CalendarClock className="w-2.5 h-2.5" /> Upcoming
              </span>
            </div>
            {anime.format && (
              <div className="absolute top-2 right-2">
                <span className="px-1.5 py-0.5 bg-white/10 backdrop-blur-sm text-white text-[8px] font-mono uppercase tracking-widest border border-white/10">
                  {anime.format}
                </span>
              </div>
            )}
            <div className="absolute bottom-0 left-0 p-3 w-full">
              <h3 className="text-white font-serif text-sm leading-tight line-clamp-2 mb-1">{title}</h3>
              <div className="flex items-center gap-1 text-[9px] font-mono text-violet-300/80 uppercase tracking-widest">
                <CalendarClock className="w-2.5 h-2.5" />
                <span>{airLabel}</span>
              </div>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function PopularCard({ anime, index }: { anime: AniMedia; index: number }) {
  const cover = anime.coverImage?.extraLarge || anime.coverImage?.large || "";
  const title = anime.title.english || anime.title.romaji;
  const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link href={`/anime/al/${anime.id}`}>
        <div className="group relative cursor-pointer">
          <div className="relative w-full aspect-[2/3] border border-white/5 bg-zinc-950 overflow-hidden">
            <img
              src={cover}
              alt={title}
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />
            <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
              {anime.format && (
                <span className="px-1.5 py-0.5 bg-white/10 backdrop-blur-sm text-white text-[8px] font-mono uppercase tracking-widest border border-white/10">
                  {anime.format}
                </span>
              )}
              {score && (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-black/70 text-white text-[9px] font-mono">
                  <Star className="w-2.5 h-2.5 fill-white/60 text-white/60" />{score}
                </span>
              )}
            </div>
            <div className="absolute bottom-0 left-0 p-3 w-full">
              <h3 className="text-white font-serif text-sm leading-tight line-clamp-2 mb-1">{title}</h3>
              <div className="flex items-center gap-1.5 text-[9px] font-mono text-white/50 uppercase tracking-widest">
                {anime.seasonYear && <span>{anime.seasonYear}</span>}
                {anime.seasonYear && <span className="w-0.5 h-0.5 rounded-full bg-white/30" />}
                <span className={anime.status === "RELEASING" ? "text-white/70" : ""}>{anime.status === "RELEASING" ? "Ongoing" : anime.status === "FINISHED" ? "Completed" : anime.status}</span>
              </div>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

export default function Home() {
  const { entries: continueWatching, removeEntry } = useContinueWatching();
  const [period, setPeriod] = useState<TrendingPeriod>("DAY");
  const [slide, setSlide] = useState(0);
  const [direction, setDirection] = useState(1);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const [heroAnime, setHeroAnime] = useState<AniMedia[]>([]);
  const [popularAnime, setPopularAnime] = useState<AniMedia[]>([]);
  const [top10Anime, setTop10Anime] = useState<AniMedia[]>([]);
  const [top10Loading, setTop10Loading] = useState(true);
  const [recentEpisodes, setRecentEpisodes] = useState<AiringEpisodeEntry[]>([]);
  const [thisSeasonAnime, setThisSeasonAnime] = useState<AniMedia[]>([]);
  const [upcomingAnime, setUpcomingAnime] = useState<AniMedia[]>([]);
  const [aniLoading, setAniLoading] = useState(true);

  useEffect(() => {
    setAniLoading(true);
    const { season, year } = getCurrentSeason();
    Promise.all([
      fetchAniList(HERO_QUERY),
      fetchAniList(POPULAR_QUERY),
      fetchRecentAiring(),
      fetchAniList(buildSeasonQuery(season, year)),
      fetchAniList(UPCOMING_QUERY),
    ]).then(([hero, popular, recent, seasonal, upcoming]) => {
      setHeroAnime(hero.filter((m) => m.bannerImage));
      setPopularAnime(popular);
      setRecentEpisodes(recent);
      setThisSeasonAnime(seasonal);
      setUpcomingAnime(upcoming);
      setAniLoading(false);
    });
  }, []);

  // Fetch Top 10 separately so period changes don't reload the whole page
  useEffect(() => {
    setTop10Loading(true);
    fetchAniList(buildTop10Query(period)).then((data) => {
      setTop10Anime(data);
      setTop10Loading(false);
    });
  }, [period]);

  const slides = heroAnime.slice(0, 8);

  const goTo = useCallback((index: number, dir?: number) => {
    setDirection(dir ?? (index > slide ? 1 : -1));
    setSlide(index);
  }, [slide]);

  const next = useCallback(() => {
    if (slides.length === 0) return;
    setDirection(1);
    setSlide((s) => (s + 1) % slides.length);
  }, [slides.length]);

  const prev = useCallback(() => {
    if (slides.length === 0) return;
    setDirection(-1);
    setSlide((s) => (s - 1 + slides.length) % slides.length);
  }, [slides.length]);

  useEffect(() => {
    if (paused || slides.length === 0) return;
    const id = setInterval(next, 5000);
    return () => clearInterval(id);
  }, [paused, next, slides.length]);

  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(delta) > 40) delta > 0 ? next() : prev();
    touchStartX.current = null;
  };

  const currentAnime = slides[slide];

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Hero carousel — negative top margin pulls it behind the transparent header */}
      {aniLoading ? (
        <div className="w-full bg-zinc-950 animate-pulse -mt-14" style={{ height: 220 }} />

      ) : slides.length > 0 ? (
        <section
          className="relative w-full overflow-hidden touch-pan-y -mt-14"
          data-testid="section-featured"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* ── MOBILE hero ── */}
          <div className="sm:hidden relative" style={{ height: 490 }}>
            {currentAnime && (
              <MobileHeroCard
                anime={currentAnime}
                direction={direction}
                dots={slides.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => goTo(i)}
                    aria-label={`Slide ${i + 1}`}
                    className="relative h-1 transition-all duration-300 focus:outline-none"
                    style={{ width: i === slide ? 20 : 6 }}
                  >
                    <span className={`absolute inset-0 transition-all duration-300 ${i === slide ? "bg-white" : "bg-white/25"}`} />
                  </button>
                ))}
              />
            )}
          </div>

          {/* ── DESKTOP hero ── */}
          <div className="hidden sm:block relative" style={{ aspectRatio: "1105/443" }}>
            <AnimatePresence mode="sync">
              <HeroSlide key={slides[slide].id} anime={slides[slide]} />
            </AnimatePresence>

            <div className="absolute right-5 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-2">
              <button onClick={prev} className="w-11 h-11 flex items-center justify-center border border-white/20 bg-black/50 text-white/60 hover:bg-white/10 hover:text-white hover:border-white/50 transition-all" aria-label="Previous">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button onClick={next} className="w-11 h-11 flex items-center justify-center border border-white/20 bg-black/50 text-white/60 hover:bg-white/10 hover:text-white hover:border-white/50 transition-all" aria-label="Next">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            <div className="relative z-10 h-full flex items-end pb-12 px-14">
              {currentAnime && <HeroText anime={currentAnime} direction={direction} />}
            </div>

            <div className="absolute top-4 right-20 z-20 text-[10px] font-mono text-white/40 tracking-widest">
              {String(slide + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
            </div>

            <div className="absolute bottom-4 left-0 right-0 z-20 flex items-center justify-center gap-1.5">
              {slides.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  aria-label={`Slide ${i + 1}`}
                  className="relative h-1 transition-all duration-300 focus:outline-none"
                  style={{ width: i === slide ? 28 : 8 }}
                >
                  <span className={`absolute inset-0 transition-all duration-300 ${i === slide ? "bg-white" : "bg-white/30 hover:bg-white/55"}`} />
                  {i === slide && (
                    <motion.span
                      className="absolute inset-0 bg-white origin-left"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 5, ease: "linear" }}
                      key={`progress-${slide}`}
                    />
                  )}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <div className="flex gap-0 items-start">
        <div className="flex-1 min-w-0">
          {/* Continue Watching */}
          {continueWatching.length > 0 && (
            <section className="px-4 sm:px-6 py-6 sm:py-8 border-b border-white/5">
              <div className="flex items-center justify-between mb-4 sm:mb-5">
                <div className="flex items-center gap-2 sm:gap-3">
                  <History className="w-4 h-4 text-orange-400/70" />
                  <h2 className="font-serif text-xl sm:text-2xl text-white">Continue Watching</h2>
                  <span className="text-[9px] font-mono text-white/25 uppercase tracking-widest hidden sm:inline">
                    {continueWatching.length} show{continueWatching.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <button
                  onClick={() => { if (confirm("Clear continue watching history?")) continueWatching.forEach(e => removeEntry(e.animeId)); }}
                  className="text-[9px] font-mono text-white/25 hover:text-white/60 uppercase tracking-widest transition-colors"
                >
                  Clear all
                </button>
              </div>
              <div className="relative">
                <motion.div
                  variants={stagger}
                  initial="hidden"
                  animate="show"
                  className="flex gap-2 sm:gap-3 overflow-x-auto pb-2 scrollbar-hide"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                  {continueWatching.map((entry) => (
                    <ContinueWatchingCard
                      key={entry.animeId}
                      entry={entry}
                      onRemove={() => removeEntry(entry.animeId)}
                    />
                  ))}
                </motion.div>
              </div>
            </section>
          )}

          {/* Top 10 */}
          <section className="pt-8 pb-6 sm:pt-10 sm:pb-8 border-b border-white/5">
            <div className="px-4 sm:px-6 mb-5 sm:mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3 flex-wrap">
                <div>
                  <p className="text-[9px] font-mono text-white/30 uppercase tracking-[0.3em] mb-0.5">Trending</p>
                  <h2 className="font-serif text-xl sm:text-2xl text-white leading-none">
                    Top 10 {period === "DAY" ? "Today" : period === "WEEK" ? "This Week" : "This Month"}
                  </h2>
                </div>
                {/* Period tabs */}
                <div className="flex items-center gap-0.5 ml-1">
                  {(["DAY", "WEEK", "MONTH"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      className={`px-2.5 py-1 text-[9px] font-mono uppercase tracking-widest transition-colors border ${
                        period === p
                          ? "bg-white text-black border-white"
                          : "text-white/35 border-white/10 hover:text-white hover:border-white/30"
                      }`}
                    >
                      {p === "DAY" ? "Day" : p === "WEEK" ? "Week" : "Month"}
                    </button>
                  ))}
                </div>
              </div>
              <Link href="/ranking">
                <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-white/30 hover:text-white transition-colors">
                  See all <ChevronRight className="w-3 h-3" />
                </span>
              </Link>
            </div>
            <div className="px-4 sm:px-6">
              <div
                className="flex overflow-x-auto pb-2"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none", gap: 4 }}
              >
                {top10Loading
                  ? Array.from({ length: 10 }).map((_, i) => (
                      <div key={i} className="flex-shrink-0 flex items-end" style={{ width: 155 }}>
                        <div className="w-11 h-20 opacity-0" />
                        <div className="flex-1 -ml-3 bg-zinc-900/70 animate-pulse" style={{ aspectRatio: "2/3" }} />
                      </div>
                    ))
                  : top10Anime.map((anime, i) => (
                      <Top10Card key={anime.id} anime={anime} rank={i + 1} index={i} />
                    ))}
              </div>
            </div>
          </section>

          {/* Popular from AniList */}
          <section className="px-4 sm:px-6 py-8 sm:py-10 border-b border-white/5">
            <div className="flex items-center justify-between mb-5 sm:mb-6">
              <div>
                <p className="text-[9px] font-mono text-white/30 uppercase tracking-[0.3em] mb-0.5">All Time</p>
                <h2 className="font-serif text-xl sm:text-2xl text-white leading-none">Most Popular</h2>
              </div>
              <Link href="/browse">
                <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-white/30 hover:text-white transition-colors">
                  Browse all <ChevronRight className="w-3 h-3" />
                </span>
              </Link>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3">
              {aniLoading
                ? Array.from({ length: 10 }).map((_, i) => <AnimeCardSkeleton key={i} />)
                : popularAnime.slice(0, 10).map((anime, i) => (
                    <PopularCard key={anime.id} anime={anime} index={i} />
                  ))}
            </div>
          </section>

          {/* This Season */}
          {(aniLoading || thisSeasonAnime.length > 0) && (
            <section className="px-4 sm:px-6 py-8 sm:py-10 border-b border-white/5">
              <div className="flex items-center justify-between mb-5 sm:mb-6">
                <div>
                  <p className="text-[9px] font-mono text-white/30 uppercase tracking-[0.3em] mb-0.5">
                    {(() => { const { season, year } = getCurrentSeason(); return `${season} ${year}`; })()}
                  </p>
                  <h2 className="font-serif text-xl sm:text-2xl text-white leading-none">This Season</h2>
                </div>
                <Link href="/browse">
                  <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-white/30 hover:text-white transition-colors">
                    Browse all <ChevronRight className="w-3 h-3" />
                  </span>
                </Link>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3">
                {aniLoading
                  ? Array.from({ length: 12 }).map((_, i) => <AnimeCardSkeleton key={i} />)
                  : thisSeasonAnime.slice(0, 18).map((anime, i) => (
                      <PopularCard key={anime.id} anime={anime} index={i} />
                    ))}
              </div>
            </section>
          )}

          {/* Upcoming Anime */}
          {(aniLoading || upcomingAnime.length > 0) && (
            <section className="px-4 sm:px-6 py-8 sm:py-10 border-b border-white/5">
              <div className="flex items-center justify-between mb-5 sm:mb-6">
                <div>
                  <p className="text-[9px] font-mono text-violet-400/70 uppercase tracking-[0.3em] mb-0.5 flex items-center gap-1.5">
                    <CalendarClock className="w-3 h-3" /> Coming Soon
                  </p>
                  <h2 className="font-serif text-xl sm:text-2xl text-white leading-none">Upcoming Anime</h2>
                </div>
                <Link href="/browse?status=NOT_YET_RELEASED">
                  <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-white/30 hover:text-white transition-colors">
                    See all <ChevronRight className="w-3 h-3" />
                  </span>
                </Link>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3">
                {aniLoading
                  ? Array.from({ length: 12 }).map((_, i) => <AnimeCardSkeleton key={i} />)
                  : upcomingAnime.slice(0, 18).map((anime, i) => (
                      <UpcomingCard key={anime.id} anime={anime} index={i} />
                    ))}
              </div>
            </section>
          )}

          {/* Latest Episodes — from AniList airing schedules */}
          <section className="px-4 sm:px-6 py-8 sm:py-10">
            <div className="flex items-center justify-between mb-5 sm:mb-6">
              <div>
                <p className="text-[9px] font-mono text-white/30 uppercase tracking-[0.3em] mb-0.5">Recently Aired</p>
                <h2 className="font-serif text-xl sm:text-2xl text-white leading-none">Latest Episodes</h2>
              </div>
              <div className="flex gap-1 text-[10px] font-mono uppercase tracking-widest">
                <button className="px-2.5 py-1 bg-white text-black">All</button>
                <button className="px-2.5 py-1 text-white/30 hover:text-white transition-colors border border-white/10 hover:border-white/30">Sub</button>
                <button className="px-2.5 py-1 text-white/30 hover:text-white transition-colors border border-white/10 hover:border-white/30">Dub</button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
              {aniLoading
                ? Array.from({ length: 8 }).map((_, i) => <AnimeCardSkeleton key={i} />)
                : recentEpisodes.slice(0, 8).map((ep, epIdx) => (
                    <motion.div key={ep.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: epIdx * 0.05, ease: [0.16, 1, 0.3, 1] }}>
                      <Link href={`/watch/al/${ep.animeId}/${ep.episodeNumber}`}>
                        <div className="group cursor-pointer border border-white/5 hover:border-white/20 transition-all overflow-hidden bg-zinc-950">
                          <div className="relative aspect-video overflow-hidden">
                            <img
                              src={ep.thumbnail}
                              alt={ep.animeTitle}
                              className="w-full h-full object-cover transition-all duration-500 group-hover:scale-105"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).src = ep.cover; }}
                              loading="lazy"
                            />
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/50">
                              <div className="w-9 h-9 rounded-full bg-white/10 border border-white/30 flex items-center justify-center backdrop-blur-sm">
                                <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                              </div>
                            </div>
                            <div className="absolute bottom-1.5 left-1.5">
                              <span className="text-[9px] font-mono bg-black/80 text-white px-1.5 py-0.5 border border-white/10">
                                EP {ep.episodeNumber}{ep.totalEpisodes ? ` / ${ep.totalEpisodes}` : ""}
                              </span>
                            </div>
                            {ep.score && (
                              <div className="absolute top-1.5 right-1.5">
                                <span className="flex items-center gap-0.5 text-[9px] font-mono bg-black/80 text-white/70 px-1.5 py-0.5">
                                  <Star className="w-2.5 h-2.5 fill-white/60 text-white/60" />
                                  {ep.score.toFixed(1)}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="p-2 sm:p-2.5">
                            <div className="flex items-center justify-between gap-1 mb-0.5">
                              <p className="text-[9px] font-mono text-white/30 uppercase tracking-widest truncate">{ep.animeTitle}</p>
                              <span className="text-[8px] font-mono text-white/20 whitespace-nowrap shrink-0">{timeAgo(ep.airingAt)}</span>
                            </div>
                            <p className="text-white text-xs font-medium line-clamp-2 leading-snug mb-1.5">{ep.episodeTitle}</p>
                            <div className="flex flex-wrap gap-1">
                              {ep.format && (
                                <span className="text-[8px] font-mono uppercase tracking-widest text-white/30 border border-white/10 px-1 py-0.5">{ep.format}</span>
                              )}
                              {ep.genres.slice(0, 1).map((g) => (
                                <span key={g} className="text-[8px] font-mono uppercase tracking-widest text-white/30 border border-white/10 px-1 py-0.5">{g}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </Link>
                    </motion.div>
                  ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

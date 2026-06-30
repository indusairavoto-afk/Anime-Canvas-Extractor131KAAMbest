import { motion } from "framer-motion";
import { Link } from "wouter";
import { useState } from "react";
import { Bookmark, BookmarkCheck, Play, Star } from "lucide-react";
import type { Anime } from "@workspace/api-client-react";
import { useWatchlist } from "@/hooks/useWatchlist";
import { NexaBadge } from "@/components/NexaBadge";

interface AnimeCardProps {
  anime: Anime;
}

export function AnimeCard({ anime }: AnimeCardProps) {
  const { toggle, isInList } = useWatchlist();
  const saved = isInList(anime.id);
  const [flipped, setFlipped] = useState(false);

  const score = Math.round(anime.rating * 10);
  const cleanDesc = anime.description?.replace(/<[^>]*>/g, "") ?? "";

  return (
    <div
      className="relative group"
      style={{ perspective: "1000px" }}
      onMouseEnter={() => setFlipped(true)}
      onMouseLeave={() => setFlipped(false)}
    >
      {/* Flip container */}
      <motion.div
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.55, ease: [0.23, 1, 0.32, 1] }}
        style={{ transformStyle: "preserve-3d", position: "relative" }}
        className="w-full aspect-[2/3]"
        data-testid={`card-anime-${anime.id}`}
      >

        {/* ── FRONT FACE ── */}
        <Link href={`/anime/${anime.id}`}>
          <div
            className="absolute inset-0 cursor-pointer border border-white/5 bg-zinc-950 overflow-hidden"
            style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
          >
            <img
              src={anime.coverImage}
              alt={anime.title}
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />

            {/* Badges top-right */}
            <div className="absolute top-2 right-2 flex gap-1">
              {anime.isTrending && (
                <span className="px-1.5 py-0.5 bg-white text-black text-[9px] font-bold uppercase tracking-widest">TREND</span>
              )}
              <span className="px-1.5 py-0.5 bg-white/10 backdrop-blur-sm text-white text-[9px] font-mono uppercase tracking-widest border border-white/10">{anime.type}</span>
            </div>

            {/* Bottom info */}
            <div className="absolute bottom-0 left-0 p-4 w-full">
              <h3 className="text-white font-serif text-base leading-tight line-clamp-2 mb-1 drop-shadow-lg">
                {anime.title}
              </h3>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[10px] font-mono text-white/60 uppercase tracking-widest">
                  <span>{anime.releaseYear}</span>
                  <span className="w-0.5 h-0.5 rounded-full bg-white/40" />
                  <span>{anime.status}</span>
                </div>
                <NexaBadge animeId={anime.id} />
              </div>
            </div>

            {/* Shimmer edge on hover */}
            <div
              className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
              style={{ boxShadow: "inset 0 0 60px rgba(255,255,255,0.06)" }}
            />
          </div>
        </Link>

        {/* ── BACK FACE ── */}
        <div
          className="absolute inset-0 border border-white/10 bg-[#0f0f0f] overflow-hidden flex flex-col"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          {/* Banner */}
          <div className="relative h-28 shrink-0 overflow-hidden">
            <img
              src={anime.bannerImage || anime.coverImage}
              alt=""
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f0f] via-[#0f0f0f]/40 to-transparent" />

            {/* Score badge */}
            {score > 0 && (
              <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/70 border border-white/10 px-1.5 py-0.5 backdrop-blur-sm">
                <Star className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400" />
                <span className="text-yellow-400 text-[9px] font-mono font-bold">{score}%</span>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex flex-col flex-1 p-3 overflow-hidden">
            <h3 className="text-white font-serif text-sm leading-snug line-clamp-2 mb-2">
              {anime.title}
            </h3>

            {/* Meta row */}
            <div className="flex items-center gap-2 text-[9px] font-mono text-white/40 uppercase tracking-widest mb-2">
              <span>{anime.releaseYear}</span>
              {anime.totalEpisodes > 0 && (
                <>
                  <span className="w-0.5 h-0.5 rounded-full bg-white/30" />
                  <span>{anime.totalEpisodes} ep</span>
                </>
              )}
              <span className="w-0.5 h-0.5 rounded-full bg-white/30" />
              <span>{anime.status}</span>
            </div>

            {/* Genres */}
            <div className="flex flex-wrap gap-1 mb-2.5">
              <span className="px-1.5 py-0.5 bg-white/10 text-white/60 text-[8px] font-mono uppercase tracking-wide">{anime.type}</span>
              {anime.genre.slice(0, 3).map((g: string) => (
                <span key={g} className="px-1.5 py-0.5 bg-white/[0.06] text-white/35 text-[8px] font-mono uppercase tracking-wide">{g}</span>
              ))}
            </div>

            {/* Description */}
            {cleanDesc && (
              <p className="text-[10px] text-white/40 leading-relaxed line-clamp-3 flex-1 mb-3">
                {cleanDesc}
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-2 mt-auto">
              <Link href={`/watch/al/${anime.id}/1`} className="flex-1">
                <button className="w-full flex items-center justify-center gap-1.5 py-2 bg-white text-black text-[10px] font-bold uppercase tracking-wider hover:bg-white/90 transition-colors">
                  <Play className="w-3 h-3 fill-current" />
                  Watch Now
                </button>
              </Link>
              <button
                onClick={(e) => { e.stopPropagation(); toggle(anime.id); }}
                className={`w-8 h-8 flex items-center justify-center border transition-colors shrink-0 ${
                  saved
                    ? "bg-white border-white text-black"
                    : "border-white/20 text-white/50 hover:border-white hover:text-white"
                }`}
                title={saved ? "Remove from My List" : "Add to My List"}
              >
                {saved ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Bookmark on front — always accessible */}
      <button
        onClick={(e) => { e.stopPropagation(); toggle(anime.id); }}
        className={`absolute top-2 left-2 z-10 w-7 h-7 flex items-center justify-center border transition-all duration-200 ${
          flipped ? "opacity-0 pointer-events-none" : ""
        } ${
          saved
            ? "bg-white text-black border-white opacity-100"
            : "opacity-0 group-hover:opacity-100 bg-black/60 text-white border-white/20 hover:bg-white hover:text-black hover:border-white"
        }`}
        title={saved ? "Remove from My List" : "Add to My List"}
        data-testid={`bookmark-${anime.id}`}
      >
        {saved ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export function AnimeCardSkeleton() {
  return <div className="w-full aspect-[2/3] bg-white/[0.03] animate-pulse border border-white/5" />;
}

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { Link } from "wouter";
import { useRef } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import type { Anime } from "@workspace/api-client-react";
import { useWatchlist } from "@/hooks/useWatchlist";
import { NexaBadge } from "@/components/NexaBadge";

interface AnimeCardProps {
  anime: Anime;
}

export function AnimeCard({ anime }: AnimeCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { toggle, isInList } = useWatchlist();
  const saved = isInList(anime.id);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const mouseXSpring = useSpring(x);
  const mouseYSpring = useSpring(y);

  const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ["12deg", "-12deg"]);
  const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ["-12deg", "12deg"]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width - 0.5;
    const yPct = (e.clientY - rect.top) / rect.height - 0.5;
    x.set(xPct);
    y.set(yPct);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <div className="relative group">
      <Link href={`/anime/${anime.id}`}>
        <motion.div
          ref={ref}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
          className="relative cursor-pointer w-full aspect-[2/3] border border-white/5 bg-zinc-950"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          data-testid={`card-anime-${anime.id}`}
        >
          <div className="absolute inset-0 overflow-hidden" style={{ transform: "translateZ(20px)" }}>
            <img
              src={anime.coverImage}
              alt={anime.title}
              className="w-full h-full object-cover transition-all duration-700 group-hover:scale-110"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
          </div>

          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
            style={{ boxShadow: "inset 0 0 60px rgba(255,255,255,0.07), 0 0 30px rgba(255,255,255,0.04)" }}
          />

          <div className="absolute top-2 right-2 flex gap-1" style={{ transform: "translateZ(40px)" }}>
            {anime.isTrending && (
              <span className="px-1.5 py-0.5 bg-white text-black text-[9px] font-bold uppercase tracking-widest">TREND</span>
            )}
            <span className="px-1.5 py-0.5 bg-white/10 backdrop-blur-sm text-white text-[9px] font-mono uppercase tracking-widest border border-white/10">{anime.type}</span>
          </div>

          <div className="absolute bottom-0 left-0 p-4 w-full" style={{ transform: "translateZ(40px)" }}>
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
        </motion.div>
      </Link>

      <button
        onClick={(e) => { e.stopPropagation(); toggle(anime.id); }}
        className={`absolute top-2 left-2 z-10 w-7 h-7 flex items-center justify-center border transition-all duration-200 opacity-0 group-hover:opacity-100 ${
          saved
            ? "bg-white text-black border-white opacity-100"
            : "bg-black/60 text-white border-white/20 hover:bg-white hover:text-black hover:border-white"
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

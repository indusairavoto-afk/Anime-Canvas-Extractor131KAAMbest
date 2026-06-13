import { motion } from "framer-motion";
import { Link } from "wouter";
import { BookmarkX, Play, Star, CheckCircle2, Clock } from "lucide-react";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useWatchProgress } from "@/hooks/useWatchProgress";
import { useGetAnime, useListEpisodes } from "@workspace/api-client-react";

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const fadeUp = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } };

function WatchlistCard({ animeId, onRemove }: { animeId: number; onRemove: () => void }) {
  const { data: anime } = useGetAnime(animeId);
  const { data: episodes } = useListEpisodes(animeId);
  const { getLastWatched, countWatched } = useWatchProgress();

  if (!anime) return <div className="aspect-[2/3] bg-white/[0.03] animate-pulse border border-white/5" />;

  const lastEpisodeId = getLastWatched(animeId);
  const watchedCount = episodes ? countWatched(episodes.map((e) => e.id)) : 0;
  const total = episodes?.length ?? anime.totalEpisodes;
  const progress = total > 0 ? (watchedCount / total) * 100 : 0;
  const continueEp = episodes?.find((e) => e.id === lastEpisodeId) ?? episodes?.[0];
  const isCompleted = watchedCount > 0 && watchedCount >= total;

  return (
    <motion.div variants={fadeUp} className="group relative flex flex-col">
      <Link href={continueEp ? `/watch/${continueEp.id}` : `/anime/${animeId}`}>
        <div className="relative aspect-[2/3] overflow-hidden border border-white/5 group-hover:border-white/20 transition-all cursor-pointer">
          <img
            src={anime.coverImage}
            alt={anime.title}
            className="w-full h-full object-cover transition-all duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

          {watchedCount > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
              <div
                className="h-full bg-white transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {isCompleted && (
            <div className="absolute top-2 left-2">
              <span className="flex items-center gap-1 text-[8px] font-mono bg-white text-black px-2 py-0.5 uppercase tracking-widest font-bold">
                <CheckCircle2 className="w-2.5 h-2.5" /> Done
              </span>
            </div>
          )}

          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
            <div className="w-10 h-10 border border-white/60 flex items-center justify-center">
              <Play className="w-4 h-4 text-white fill-white ml-0.5" />
            </div>
          </div>

          <button
            onClick={(e) => { e.preventDefault(); onRemove(); }}
            className="absolute top-2 right-2 w-7 h-7 bg-black/70 border border-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white hover:text-black text-white"
            title="Remove from list"
          >
            <BookmarkX className="w-3.5 h-3.5" />
          </button>

          <div className="absolute bottom-2 left-0 right-0 px-3">
            <h3 className="text-white font-serif text-sm leading-snug line-clamp-2">{anime.title}</h3>
            <div className="flex items-center gap-2 mt-1 text-[9px] font-mono text-white/50 uppercase tracking-widest">
              <span className="flex items-center gap-1"><Star className="w-2.5 h-2.5" />{anime.rating.toFixed(1)}</span>
              <span className="w-0.5 h-0.5 rounded-full bg-white/30" />
              {watchedCount > 0 ? (
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-2.5 h-2.5" />{watchedCount}/{total}
                </span>
              ) : (
                <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />Not started</span>
              )}
            </div>
          </div>
        </div>
      </Link>

      {continueEp && watchedCount > 0 && !isCompleted && (
        <Link href={`/watch/${continueEp.id}`}>
          <div className="mt-1.5 flex items-center gap-2 border border-white/10 px-3 py-2 hover:border-white/30 hover:bg-white/[0.03] transition-all cursor-pointer">
            <Play className="w-3 h-3 text-white/50 fill-white/50 flex-shrink-0" />
            <span className="text-white/50 text-[10px] font-mono truncate">Continue EP {continueEp.episodeNumber}</span>
          </div>
        </Link>
      )}
      {continueEp && watchedCount === 0 && (
        <Link href={`/watch/${continueEp.id}`}>
          <div className="mt-1.5 flex items-center gap-2 border border-white/10 px-3 py-2 hover:border-white/30 hover:bg-white/[0.03] transition-all cursor-pointer">
            <Play className="w-3 h-3 text-white/50 fill-white/50 flex-shrink-0" />
            <span className="text-white/50 text-[10px] font-mono truncate">Start watching</span>
          </div>
        </Link>
      )}
    </motion.div>
  );
}

export default function Watchlist() {
  const { ids, toggle } = useWatchlist();

  return (
    <div className="bg-black text-white min-h-screen">
      <div className="border-b border-white/5 pt-12 pb-10 px-4 sm:px-8 lg:px-16">
        <div className="max-w-7xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <p className="text-[10px] font-mono text-white/30 uppercase tracking-[0.3em] mb-3">My Library</p>
            <h1 className="font-serif text-5xl text-white mb-2">My List</h1>
            <p className="text-white/40 text-sm font-mono">
              {ids.length} {ids.length === 1 ? "series" : "series"} saved
            </p>
          </motion.div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-16 py-12">
        {ids.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-32 text-center"
          >
            <div className="w-20 h-20 border border-white/10 flex items-center justify-center mb-8">
              <BookmarkX className="w-8 h-8 text-white/20" />
            </div>
            <h2 className="font-serif text-3xl text-white mb-3">Your list is empty</h2>
            <p className="text-white/40 text-sm max-w-sm mb-8">
              Bookmark any anime to save it here. Look for the bookmark icon on anime cards and detail pages.
            </p>
            <Link href="/browse">
              <button className="px-8 py-3 bg-white text-black text-xs font-bold uppercase tracking-widest hover:bg-white/90 transition-colors">
                Browse Anime
              </button>
            </Link>
          </motion.div>
        ) : (
          <motion.div
            variants={stagger}
            initial="hidden"
            animate="show"
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
          >
            {ids.map((id) => (
              <WatchlistCard key={id} animeId={id} onRemove={() => toggle(id)} />
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}

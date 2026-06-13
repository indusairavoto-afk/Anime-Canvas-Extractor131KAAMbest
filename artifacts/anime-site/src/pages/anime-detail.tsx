import { motion } from "framer-motion";
import { Link, useParams } from "wouter";
import { Play, Star, Calendar, Tv, ArrowLeft, Clock, Bookmark, BookmarkCheck, CheckCircle2 } from "lucide-react";
import {
  useGetAnime,
  getGetAnimeQueryKey,
  useListEpisodes,
  getListEpisodesQueryKey,
} from "@workspace/api-client-react";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useWatchProgress } from "@/hooks/useWatchProgress";

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } };

export default function AnimeDetail() {
  const params = useParams();
  const id = parseInt(params.id ?? "0");
  const { toggle, isInList } = useWatchlist();
  const { isWatched, getLastWatched, countWatched } = useWatchProgress();
  const saved = isInList(id);

  const { data: anime, isLoading } = useGetAnime(id, {
    query: { enabled: !!id, queryKey: getGetAnimeQueryKey(id) },
  });
  const { data: episodes, isLoading: epsLoading } = useListEpisodes(id, {
    query: { enabled: !!id, queryKey: getListEpisodesQueryKey(id) },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black">
        <div className="h-[40vh] bg-zinc-950 animate-pulse" />
        <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-16 py-16 space-y-6">
          <div className="h-12 bg-white/5 w-1/2 animate-pulse" />
          <div className="h-4 bg-white/5 w-full animate-pulse" />
          <div className="h-4 bg-white/5 w-3/4 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!anime) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-white/40 font-mono">Anime not found</p>
      </div>
    );
  }

  const lastEpisodeId = getLastWatched(id);
  const watchedCount = episodes ? countWatched(episodes.map((e) => e.id)) : 0;
  const continueEp = episodes?.find((e) => e.id === lastEpisodeId);
  const firstEpisode = episodes?.[0];
  const resumeEp = continueEp ?? firstEpisode;

  return (
    <div className="bg-black text-white min-h-screen">
      <div className="relative h-[40vh] sm:h-[55vh] overflow-hidden">
        <img
          src={anime.bannerImage}
          alt={anime.title}
          className="w-full h-full object-cover"
          style={{ filter: "brightness(0.35) contrast(1.1)" }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent" />
        <div className="absolute top-4 sm:top-6 left-4 sm:left-8 lg:left-16">
          <Link href="/browse">
            <button className="flex items-center gap-2 text-white/50 hover:text-white text-xs sm:text-sm font-mono uppercase tracking-widest transition-colors" data-testid="button-back">
              <ArrowLeft className="w-4 h-4" /> Browse
            </button>
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-16 -mt-36 sm:-mt-48 relative z-10 pb-16 sm:pb-24">
        <div className="flex gap-4 sm:gap-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6 }}
            className="flex-shrink-0 w-28 sm:w-48"
          >
            <div className="aspect-[2/3] border border-white/10 overflow-hidden shadow-2xl">
              <img src={anime.coverImage} alt={anime.title} className="w-full h-full object-cover" />
            </div>
          </motion.div>

          <div className="flex-1 pt-20 sm:pt-28 min-w-0">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              {anime.japaneseTitle && (
                <p className="hidden sm:block text-white/30 font-mono text-xs tracking-widest uppercase mb-2">{anime.japaneseTitle}</p>
              )}
              <h1 className="font-serif text-3xl sm:text-5xl lg:text-6xl text-white leading-tight mb-3 sm:mb-4">{anime.title}</h1>
              <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-4 sm:mb-6 text-xs font-mono text-white/50 uppercase tracking-widest">
                <span className="flex items-center gap-1.5"><Star className="w-3 h-3" />{anime.rating.toFixed(1)}</span>
                <span className="flex items-center gap-1.5"><Calendar className="w-3 h-3" />{anime.releaseYear}</span>
                <span className="hidden sm:flex items-center gap-1.5"><Tv className="w-3 h-3" />{anime.totalEpisodes} eps</span>
                <span className={`px-2 py-0.5 border text-[9px] ${anime.status === "ongoing" ? "border-white/30 text-white" : "border-white/10 text-white/40"}`}>{anime.status}</span>
                <span className="px-2 py-0.5 border border-white/10 text-[9px]">{anime.type}</span>
                {watchedCount > 0 && (
                  <span className="hidden sm:flex items-center gap-1.5 text-white/50">
                    <CheckCircle2 className="w-3 h-3" />{watchedCount}/{episodes?.length ?? anime.totalEpisodes} watched
                  </span>
                )}
              </div>
              <div className="hidden sm:flex flex-wrap gap-2 mb-6">
                {anime.genre.map((g) => (
                  <Link key={g} href={`/browse?genre=${encodeURIComponent(g)}`}>
                    <span className="text-[10px] font-mono uppercase tracking-widest border border-white/10 px-3 py-1 text-white/50 hover:border-white/30 hover:text-white transition-colors cursor-pointer">{g}</span>
                  </Link>
                ))}
              </div>
              <p className="hidden sm:block text-white/70 leading-relaxed max-w-2xl mb-4 sm:mb-8">{anime.description}</p>
              <p className="hidden sm:block text-white/30 text-xs font-mono uppercase tracking-widest mb-6 sm:mb-8">Studio: {anime.studio}</p>
              <div className="flex flex-wrap gap-2 sm:gap-3">
                {resumeEp && (
                  <Link href={`/watch/${resumeEp.id}`}>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      className="flex items-center gap-2 sm:gap-3 bg-white text-black px-5 sm:px-8 py-3 sm:py-3.5 font-bold text-xs sm:text-sm uppercase tracking-widest hover:bg-white/90 transition-colors"
                      data-testid="button-watch-first"
                    >
                      <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-black" />
                      {continueEp ? `Continue EP ${continueEp.episodeNumber}` : "Watch EP 1"}
                    </motion.button>
                  </Link>
                )}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => toggle(id)}
                  className={`flex items-center gap-2 border px-4 sm:px-6 py-3 sm:py-3.5 text-xs sm:text-sm font-bold uppercase tracking-widest transition-all ${
                    saved ? "border-white bg-white text-black" : "border-white/20 text-white hover:border-white/50"
                  }`}
                  data-testid="button-bookmark"
                >
                  {saved ? <BookmarkCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Bookmark className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                  {saved ? "In My List" : "Add to List"}
                </motion.button>
              </div>
            </motion.div>
          </div>
        </div>

        <div className="sm:hidden mt-6 space-y-4">
          <p className="text-white/70 text-sm leading-relaxed">{anime.description}</p>
          <div className="flex flex-wrap gap-1.5">
            {anime.genre.map((g) => (
              <Link key={g} href={`/browse?genre=${encodeURIComponent(g)}`}>
                <span className="text-[10px] font-mono uppercase tracking-widest border border-white/10 px-2.5 py-1 text-white/50">{g}</span>
              </Link>
            ))}
          </div>
          <p className="text-white/30 text-[10px] font-mono uppercase tracking-widest">Studio: {anime.studio} · {anime.totalEpisodes} episodes</p>
          {watchedCount > 0 && (
            <p className="text-white/40 text-[10px] font-mono uppercase tracking-widest flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> {watchedCount}/{episodes?.length ?? anime.totalEpisodes} episodes watched
            </p>
          )}
        </div>

        {!epsLoading && episodes && episodes.length > 0 && (
          <div className="mt-12 sm:mt-20">
            <div className="flex items-center gap-3 mb-5 sm:mb-8">
              <h2 className="font-serif text-2xl sm:text-3xl text-white">Episodes</h2>
              <span className="text-white/30 font-mono text-sm">{episodes.length}</span>
              {watchedCount > 0 && (
                <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest border border-white/10 px-2 py-0.5 ml-1">
                  {watchedCount} watched
                </span>
              )}
            </div>
            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              className="space-y-1.5 sm:space-y-2"
            >
              {episodes.map((ep) => {
                const watched = isWatched(ep.id);
                return (
                  <motion.div key={ep.id} variants={fadeUp}>
                    <Link href={`/watch/${ep.id}`}>
                      <div
                        className={`group flex items-center gap-3 sm:gap-4 border p-3 sm:p-4 hover:border-white/20 hover:bg-white/[0.02] transition-all cursor-pointer ${watched ? "border-white/10 bg-white/[0.02]" : "border-white/5"}`}
                        data-testid={`row-episode-${ep.id}`}
                      >
                        <div className="relative flex-shrink-0 w-20 sm:w-28 overflow-hidden">
                          <img src={ep.thumbnailUrl} alt={ep.title} className="w-full aspect-video object-cover transition-all duration-500" />
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                            <Play className="w-4 h-4 sm:w-5 sm:h-5 text-white fill-white" />
                          </div>
                          {watched && (
                            <div className="absolute bottom-1 right-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-white drop-shadow" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 sm:mb-1">
                            <span className={`text-[10px] font-mono uppercase tracking-widest ${watched ? "text-white/50" : "text-white/30"}`}>EP {ep.episodeNumber}</span>
                            <span className="text-[9px] font-mono uppercase tracking-widest border border-white/10 px-1.5 py-0.5 text-white/30">{ep.type}</span>
                            {watched && <span className="hidden sm:inline text-[9px] font-mono text-white/40 uppercase tracking-widest">Watched</span>}
                          </div>
                          <h3 className={`font-medium text-sm sm:text-base group-hover:text-white transition-colors ${watched ? "text-white/60" : "text-white"}`}>{ep.title}</h3>
                          {ep.description && <p className="hidden sm:block text-white/40 text-xs mt-1 line-clamp-1">{ep.description}</p>}
                        </div>
                        <div className="text-right flex-shrink-0 hidden sm:block">
                          <div className="flex items-center gap-1.5 text-white/30 text-xs font-mono">
                            <Clock className="w-3 h-3" />{ep.duration}m
                          </div>
                          <p className="text-white/20 text-[10px] font-mono mt-1">{ep.releaseDate}</p>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}

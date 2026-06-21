import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import { BookmarkX, Play, Star, CheckCircle2, Clock, BookOpen, Tv } from "lucide-react";
import { useState, useEffect } from "react";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useMangaList } from "@/hooks/useMangaList";
import { useWatchProgress } from "@/hooks/useWatchProgress";
import { useGetAnime, useListEpisodes } from "@workspace/api-client-react";

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const fadeUp = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } };

/* ── Anime card (unchanged) ─────────────────────────────────────────────── */
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
          <img src={anime.coverImage} alt={anime.title} className="w-full h-full object-cover transition-all duration-500 group-hover:scale-105" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

          {watchedCount > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
              <div className="h-full bg-white transition-all duration-500" style={{ width: `${progress}%` }} />
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
                <span className="flex items-center gap-1"><CheckCircle2 className="w-2.5 h-2.5" />{watchedCount}/{total}</span>
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

/* ── Manga card ─────────────────────────────────────────────────────────── */
interface MangaInfo {
  id: number;
  title: { romaji: string; english?: string | null };
  coverImage: { large?: string; extraLarge?: string };
  averageScore?: number | null;
  status: string;
  chapters?: number | null;
}

const MANGA_QUERY = `
query ($id: Int!) {
  Media(id: $id, type: MANGA) {
    id title { romaji english } coverImage { extraLarge large }
    averageScore status chapters
  }
}`;

function MangaReadCard({ mangaId, onRemove }: { mangaId: number; onRemove: () => void }) {
  const [manga, setManga] = useState<MangaInfo | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: MANGA_QUERY, variables: { id: mangaId } }),
    })
      .then((r) => r.json())
      .then((j) => { if (alive) setManga(j?.data?.Media ?? null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [mangaId]);

  if (!manga) return <div className="aspect-[2/3] bg-white/[0.03] animate-pulse border border-white/5" />;

  const title = manga.title.english ?? manga.title.romaji;
  const cover = manga.coverImage?.extraLarge ?? manga.coverImage?.large ?? "";
  const score = manga.averageScore ? (manga.averageScore / 10).toFixed(1) : null;

  return (
    <motion.div variants={fadeUp} className="group relative flex flex-col">
      <Link href={`/manga/al/${mangaId}`}>
        <div className="relative aspect-[2/3] overflow-hidden border border-white/5 group-hover:border-white/20 transition-all cursor-pointer">
          {cover && (
            <img src={cover} alt={title} className="w-full h-full object-cover transition-all duration-500 group-hover:scale-105" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
            <div className="w-10 h-10 border border-white/60 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-white" />
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
            <h3 className="text-white font-serif text-sm leading-snug line-clamp-2">{title}</h3>
            <div className="flex items-center gap-2 mt-1 text-[9px] font-mono text-white/50 uppercase tracking-widest">
              {score && <span className="flex items-center gap-1"><Star className="w-2.5 h-2.5" />{score}</span>}
              {score && manga.chapters && <span className="w-0.5 h-0.5 rounded-full bg-white/30" />}
              {manga.chapters && <span>{manga.chapters} ch</span>}
            </div>
          </div>
        </div>
      </Link>

      <Link href={`/manga/al/${mangaId}`}>
        <div className="mt-1.5 flex items-center gap-2 border border-white/10 px-3 py-2 hover:border-white/30 hover:bg-white/[0.03] transition-all cursor-pointer">
          <BookOpen className="w-3 h-3 text-white/50 flex-shrink-0" />
          <span className="text-white/50 text-[10px] font-mono truncate">Read manga</span>
        </div>
      </Link>
    </motion.div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────────── */
type Tab = "anime" | "manga";

export default function Watchlist() {
  const { ids: animeIds, toggle: toggleAnime } = useWatchlist();
  const { ids: mangaIds, toggle: toggleManga } = useMangaList();
  const [tab, setTab] = useState<Tab>("anime");

  const totalCount = tab === "anime" ? animeIds.length : mangaIds.length;

  return (
    <div className="bg-black text-white min-h-screen">
      {/* Header */}
      <div className="border-b border-white/5 pt-12 pb-0 px-4 sm:px-8 lg:px-16">
        <div className="max-w-7xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <p className="text-[10px] font-mono text-white/30 uppercase tracking-[0.3em] mb-3">My Library</p>
            <h1 className="font-serif text-5xl text-white mb-6">My List</h1>
          </motion.div>

          {/* Tabs */}
          <div className="flex items-end gap-0">
            <button
              onClick={() => setTab("anime")}
              className={`relative flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-widest border-b-2 transition-colors ${
                tab === "anime"
                  ? "border-white text-white"
                  : "border-transparent text-white/35 hover:text-white/60"
              }`}
            >
              <Tv className="w-3.5 h-3.5" />
              Anime
              {animeIds.length > 0 && (
                <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded-sm leading-none ${tab === "anime" ? "bg-white text-black" : "bg-white/10 text-white/40"}`}>
                  {animeIds.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab("manga")}
              className={`relative flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-widest border-b-2 transition-colors ${
                tab === "manga"
                  ? "border-white text-white"
                  : "border-transparent text-white/35 hover:text-white/60"
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              Manga
              {mangaIds.length > 0 && (
                <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded-sm leading-none ${tab === "manga" ? "bg-white text-black" : "bg-white/10 text-white/40"}`}>
                  {mangaIds.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-16 py-12">
        <AnimatePresence mode="wait">
          {tab === "anime" ? (
            <motion.div key="anime" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {animeIds.length === 0 ? (
                <EmptyState
                  icon={<Tv className="w-8 h-8 text-white/20" />}
                  title="No anime saved"
                  description="Bookmark any anime to save it here. Look for the bookmark icon on anime cards."
                  cta={{ label: "Browse Anime", href: "/browse" }}
                />
              ) : (
                <motion.div variants={stagger} initial="hidden" animate="show"
                  className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {animeIds.map((id) => (
                    <WatchlistCard key={id} animeId={id} onRemove={() => toggleAnime(id)} />
                  ))}
                </motion.div>
              )}
            </motion.div>
          ) : (
            <motion.div key="manga" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {mangaIds.length === 0 ? (
                <EmptyState
                  icon={<BookOpen className="w-8 h-8 text-white/20" />}
                  title="No manga saved"
                  description="Bookmark any manga to save it here. Look for the bookmark icon on manga cards and detail pages."
                  cta={{ label: "Browse Manga", href: "/manga" }}
                />
              ) : (
                <motion.div variants={stagger} initial="hidden" animate="show"
                  className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {mangaIds.map((id) => (
                    <MangaReadCard key={id} mangaId={id} onRemove={() => toggleManga(id)} />
                  ))}
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: { label: string; href: string };
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-32 text-center"
    >
      <div className="w-20 h-20 border border-white/10 flex items-center justify-center mb-8">
        {icon}
      </div>
      <h2 className="font-serif text-3xl text-white mb-3">{title}</h2>
      <p className="text-white/40 text-sm max-w-sm mb-8">{description}</p>
      <Link href={cta.href}>
        <button className="px-8 py-3 bg-white text-black text-xs font-bold uppercase tracking-widest hover:bg-white/90 transition-colors">
          {cta.label}
        </button>
      </Link>
    </motion.div>
  );
}

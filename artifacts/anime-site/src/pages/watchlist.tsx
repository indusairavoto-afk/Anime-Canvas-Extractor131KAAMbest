import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import { BookmarkX, Play, Star, CheckCircle2, Clock, BookOpen, Tv, Check, Minus, Plus } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useMangaList, type ReadStatus } from "@/hooks/useMangaList";
import { useWatchProgress } from "@/hooks/useWatchProgress";
import { useGetAnime, useListEpisodes } from "@workspace/api-client-react";

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const fadeUp  = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } };

const READ_STATUSES: { value: ReadStatus; label: string; dot: string; pill: string }[] = [
  { value: "reading",      label: "Reading",      dot: "bg-green-400",  pill: "border-green-400/30 text-green-400 bg-green-400/[0.08]" },
  { value: "plan_to_read", label: "Plan to Read", dot: "bg-blue-400",   pill: "border-blue-400/30 text-blue-400 bg-blue-400/[0.08]" },
  { value: "completed",    label: "Completed",    dot: "bg-purple-400", pill: "border-purple-400/30 text-purple-400 bg-purple-400/[0.08]" },
];

const ANILIST_ANIME_QUERY = `
query ($id: Int!) {
  Media(id: $id, type: ANIME) {
    id
    title { romaji english }
    coverImage { extraLarge large }
    averageScore
    episodes
    status
  }
}`;

interface AnilistAnimeInfo {
  id: number;
  title: { romaji: string; english?: string | null };
  coverImage: { extraLarge?: string; large?: string };
  averageScore?: number | null;
  episodes?: number | null;
  status: string;
}

/* ── Anime card ─────────────────────────────────────────────────────────── */
function WatchlistCard({ animeId, onRemove }: { animeId: number; onRemove: () => void }) {
  const { data: localAnime, isError: localError, isPending: localPending } = useGetAnime(animeId, {
    query: { retry: false },
  });
  const { data: episodes } = useListEpisodes(animeId);
  const { getLastWatched, countWatched } = useWatchProgress();
  const [anilistAnime, setAnilistAnime] = useState<AnilistAnimeInfo | null>(null);
  const [anilistLoading, setAnilistLoading] = useState(false);

  useEffect(() => {
    if (!localError) return;
    let alive = true;
    setAnilistLoading(true);
    fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: ANILIST_ANIME_QUERY, variables: { id: animeId } }),
    })
      .then((r) => r.json())
      .then((j) => { if (alive) setAnilistAnime(j?.data?.Media ?? null); })
      .catch(() => {})
      .finally(() => { if (alive) setAnilistLoading(false); });
    return () => { alive = false; };
  }, [animeId, localError]);

  const isLoading = localPending || (localError && anilistLoading);

  if (isLoading) {
    return <div className="aspect-[2/3] bg-white/[0.03] animate-pulse border border-white/5" />;
  }

  if (localAnime) {
    const lastEpisodeId = getLastWatched(animeId);
    const watchedCount  = episodes ? countWatched(episodes.map((e) => e.id)) : 0;
    const total         = episodes?.length ?? localAnime.totalEpisodes;
    const progress      = total > 0 ? (watchedCount / total) * 100 : 0;
    const continueEp    = episodes?.find((e) => e.id === lastEpisodeId) ?? episodes?.[0];
    const isCompleted   = watchedCount > 0 && watchedCount >= total;

    return (
      <motion.div variants={fadeUp} className="group relative flex flex-col">
        <Link href={continueEp ? `/watch/${continueEp.id}` : `/anime/${animeId}`}>
          <div className="relative aspect-[2/3] overflow-hidden border border-white/5 group-hover:border-white/20 transition-all cursor-pointer">
            <img src={localAnime.coverImage} alt={localAnime.title} className="w-full h-full object-cover transition-all duration-500 group-hover:scale-105" />
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
            <button onClick={(e) => { e.preventDefault(); onRemove(); }}
              className="absolute top-2 right-2 w-7 h-7 bg-black/70 border border-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white hover:text-black text-white"
              title="Remove from list">
              <BookmarkX className="w-3.5 h-3.5" />
            </button>
            <div className="absolute bottom-2 left-0 right-0 px-3">
              <h3 className="text-white font-serif text-sm leading-snug line-clamp-2">{localAnime.title}</h3>
              <div className="flex items-center gap-2 mt-1 text-[9px] font-mono text-white/50 uppercase tracking-widest">
                <span className="flex items-center gap-1"><Star className="w-2.5 h-2.5" />{localAnime.rating.toFixed(1)}</span>
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

  if (anilistAnime) {
    const title  = anilistAnime.title.english ?? anilistAnime.title.romaji;
    const cover  = anilistAnime.coverImage.extraLarge ?? anilistAnime.coverImage.large ?? "";
    const score  = anilistAnime.averageScore ? (anilistAnime.averageScore / 10).toFixed(1) : null;
    const total  = anilistAnime.episodes ?? 0;

    return (
      <motion.div variants={fadeUp} className="group relative flex flex-col">
        <Link href={`/anime/al/${animeId}`}>
          <div className="relative aspect-[2/3] overflow-hidden border border-white/5 group-hover:border-white/20 transition-all cursor-pointer">
            {cover && <img src={cover} alt={title} className="w-full h-full object-cover transition-all duration-500 group-hover:scale-105" />}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
              <div className="w-10 h-10 border border-white/60 flex items-center justify-center">
                <Play className="w-4 h-4 text-white fill-white ml-0.5" />
              </div>
            </div>
            <button onClick={(e) => { e.preventDefault(); onRemove(); }}
              className="absolute top-2 right-2 w-7 h-7 bg-black/70 border border-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white hover:text-black text-white"
              title="Remove from list">
              <BookmarkX className="w-3.5 h-3.5" />
            </button>
            <div className="absolute bottom-2 left-0 right-0 px-3">
              <h3 className="text-white font-serif text-sm leading-snug line-clamp-2">{title}</h3>
              <div className="flex items-center gap-2 mt-1 text-[9px] font-mono text-white/50 uppercase tracking-widest">
                {score && <span className="flex items-center gap-1"><Star className="w-2.5 h-2.5" />{score}</span>}
                {score && total > 0 && <span className="w-0.5 h-0.5 rounded-full bg-white/30" />}
                {total > 0 && <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{total} eps</span>}
              </div>
            </div>
          </div>
        </Link>
        <Link href={`/anime/al/${animeId}`}>
          <div className="mt-1.5 flex items-center gap-2 border border-white/10 px-3 py-2 hover:border-white/30 hover:bg-white/[0.03] transition-all cursor-pointer">
            <Play className="w-3 h-3 text-white/50 fill-white/50 flex-shrink-0" />
            <span className="text-white/50 text-[10px] font-mono truncate">Start watching</span>
          </div>
        </Link>
      </motion.div>
    );
  }

  return <div className="aspect-[2/3] bg-white/[0.03] border border-white/5" />;
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

function MangaReadCard({
  mangaId,
  readStatus,
  chapter,
  onRemove,
  onStatusChange,
  onChapterChange,
}: {
  mangaId: number;
  readStatus: ReadStatus;
  chapter: number;
  onRemove: () => void;
  onStatusChange: (s: ReadStatus) => void;
  onChapterChange: (n: number) => void;
}) {
  const [manga, setManga]         = useState<MangaInfo | null>(null);
  const [menuOpen, setMenuOpen]   = useState(false);
  const [inputVal, setInputVal]   = useState<string | null>(null);
  const inputRef                  = useRef<HTMLInputElement>(null);
  const cfg = READ_STATUSES.find((s) => s.value === readStatus)!;

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

  const title    = manga.title.english ?? manga.title.romaji;
  const cover    = manga.coverImage?.extraLarge ?? manga.coverImage?.large ?? "";
  const score    = manga.averageScore ? (manga.averageScore / 10).toFixed(1) : null;
  const total    = manga.chapters ?? null;
  const progress = total && chapter > 0 ? Math.min(100, Math.round((chapter / total) * 100)) : 0;

  const commitInput = () => {
    if (inputVal !== null) {
      const n = parseInt(inputVal, 10);
      if (!isNaN(n)) onChapterChange(Math.max(0, n));
      setInputVal(null);
    }
  };

  return (
    <motion.div variants={fadeUp} className="group relative flex flex-col">
      <Link href={`/manga/al/${mangaId}`}>
        <div className="relative aspect-[2/3] overflow-hidden border border-white/5 group-hover:border-white/20 transition-all cursor-pointer">
          {cover && <img src={cover} alt={title} className="w-full h-full object-cover transition-all duration-500 group-hover:scale-105" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

          {/* Progress bar */}
          {progress > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
              <div className="h-full bg-white/60 transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          )}

          {/* Status dot */}
          <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/60 backdrop-blur-sm border border-white/10">
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            <span className="text-[8px] font-mono uppercase tracking-widest text-white/60">{cfg.label}</span>
          </div>

          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
            <div className="w-10 h-10 border border-white/60 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-white" />
            </div>
          </div>

          <button onClick={(e) => { e.preventDefault(); onRemove(); }}
            className="absolute top-2 right-2 w-7 h-7 bg-black/70 border border-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white hover:text-black text-white"
            title="Remove from list">
            <BookmarkX className="w-3.5 h-3.5" />
          </button>

          <div className="absolute bottom-2 left-0 right-0 px-3">
            <h3 className="text-white font-serif text-sm leading-snug line-clamp-2">{title}</h3>
            <div className="flex items-center gap-2 mt-1 text-[9px] font-mono text-white/50 uppercase tracking-widest">
              {score && <span className="flex items-center gap-1"><Star className="w-2.5 h-2.5" />{score}</span>}
              {score && <span className="w-0.5 h-0.5 rounded-full bg-white/30" />}
              {chapter > 0
                ? <span>Ch. {chapter}{total ? ` / ${total}` : ""}</span>
                : total
                  ? <span>{total} ch total</span>
                  : null}
            </div>
          </div>
        </div>
      </Link>

      {/* Chapter stepper */}
      <div className="flex items-stretch border border-white/10 mt-1.5 overflow-hidden">
        <button
          onClick={() => onChapterChange(Math.max(0, chapter - 1))}
          className="px-2.5 py-2 text-white/30 hover:text-white hover:bg-white/[0.05] transition-colors flex-shrink-0"
        >
          <Minus className="w-3 h-3" />
        </button>

        <div className="flex-1 flex items-center justify-center gap-1 px-1 border-x border-white/[0.07]">
          <span className="text-white/25 text-[9px] font-mono">CH</span>
          <input
            ref={inputRef}
            type="number"
            min={0}
            value={inputVal ?? chapter}
            onChange={(e) => setInputVal(e.target.value)}
            onBlur={commitInput}
            onKeyDown={(e) => { if (e.key === "Enter") inputRef.current?.blur(); }}
            className="w-10 bg-transparent text-center text-[11px] font-mono text-white py-1.5 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          {total && <span className="text-white/20 text-[9px] font-mono">/{total}</span>}
        </div>

        <button
          onClick={() => onChapterChange(chapter + 1)}
          className="px-2.5 py-2 text-white/30 hover:text-white hover:bg-white/[0.05] transition-colors flex-shrink-0"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Status changer */}
      <div className="relative mt-1">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="w-full flex items-center gap-2 border border-white/10 px-3 py-2 hover:border-white/25 hover:bg-white/[0.03] transition-all"
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
          <span className="text-white/50 text-[10px] font-mono flex-1 text-left">{cfg.label}</span>
          <span className="text-white/20 text-[9px]">▾</span>
        </button>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.1 }}
              className="absolute bottom-full left-0 right-0 mb-1 z-20 bg-zinc-900 border border-white/10 shadow-2xl overflow-hidden"
            >
              {READ_STATUSES.map(({ value, label, dot }) => (
                <button
                  key={value}
                  onClick={() => { onStatusChange(value); setMenuOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-[10px] font-mono transition-colors ${
                    value === readStatus
                      ? "text-white bg-white/[0.07]"
                      : "text-white/40 hover:text-white/70 hover:bg-white/[0.04]"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                  {label}
                  {value === readStatus && <Check className="w-3 h-3 ml-auto" />}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────────── */
type Tab = "anime" | "manga";

export default function Watchlist() {
  const { ids: animeIds, toggle: toggleAnime } = useWatchlist();
  const { entries, remove: removeManga, setStatus, setChapter, byStatus } = useMangaList();
  const [tab, setTab]         = useState<Tab>("anime");
  const [statusFilter, setStatusFilter] = useState<ReadStatus | "all">("all");

  const filteredManga =
    statusFilter === "all" ? entries : byStatus(statusFilter as ReadStatus);

  return (
    <div className="bg-black text-white min-h-screen">
      {/* Header */}
      <div className="border-b border-white/5 pt-12 pb-0 px-4 sm:px-8 lg:px-16">
        <div className="max-w-7xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <p className="text-[10px] font-mono text-white/30 uppercase tracking-[0.3em] mb-3">My Library</p>
            <h1 className="font-serif text-5xl text-white mb-6">My List</h1>
          </motion.div>

          {/* Main tabs */}
          <div className="flex items-end gap-0">
            {(["anime", "manga"] as Tab[]).map((t) => {
              const count = t === "anime" ? animeIds.length : entries.length;
              return (
                <button key={t} onClick={() => setTab(t)}
                  className={`relative flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-widest border-b-2 transition-colors ${
                    tab === t ? "border-white text-white" : "border-transparent text-white/35 hover:text-white/60"
                  }`}
                >
                  {t === "anime" ? <Tv className="w-3.5 h-3.5" /> : <BookOpen className="w-3.5 h-3.5" />}
                  {t}
                  {count > 0 && (
                    <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded-sm leading-none ${tab === t ? "bg-white text-black" : "bg-white/10 text-white/40"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-16 py-10">
        <AnimatePresence mode="wait">

          {tab === "anime" ? (
            <motion.div key="anime" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {animeIds.length === 0 ? (
                <EmptyState icon={<Tv className="w-8 h-8 text-white/20" />} title="No anime saved"
                  description="Bookmark any anime to save it here. Look for the bookmark icon on anime cards."
                  cta={{ label: "Browse Anime", href: "/browse" }} />
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
              {entries.length === 0 ? (
                <EmptyState icon={<BookOpen className="w-8 h-8 text-white/20" />} title="No manga saved"
                  description="Add any manga to your list from the manga browse or detail pages."
                  cta={{ label: "Browse Manga", href: "/manga" }} />
              ) : (
                <>
                  {/* Status filter pills */}
                  <div className="flex items-center gap-2 flex-wrap mb-8">
                    <button
                      onClick={() => setStatusFilter("all")}
                      className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border transition-colors ${
                        statusFilter === "all"
                          ? "border-white/30 text-white bg-white/[0.07]"
                          : "border-white/[0.07] text-white/30 hover:border-white/20 hover:text-white/60"
                      }`}
                    >
                      All
                      <span className="ml-1.5 opacity-60">{entries.length}</span>
                    </button>
                    {READ_STATUSES.map(({ value, label, dot, pill }) => {
                      const count = byStatus(value).length;
                      if (count === 0) return null;
                      return (
                        <button
                          key={value}
                          onClick={() => setStatusFilter(statusFilter === value ? "all" : value)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border transition-colors ${
                            statusFilter === value ? pill : "border-white/[0.07] text-white/30 hover:border-white/20 hover:text-white/60"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                          {label}
                          <span className="ml-0.5 opacity-60">{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  <AnimatePresence mode="wait">
                    <motion.div
                      key={statusFilter}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      transition={{ duration: 0.12 }}
                    >
                      {filteredManga.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3">
                          <p className="text-white/20 font-mono text-xs uppercase tracking-widest">
                            Nothing with this status yet
                          </p>
                        </div>
                      ) : (
                        <motion.div variants={stagger} initial="hidden" animate="show"
                          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                          {filteredManga.map((entry) => (
                            <MangaReadCard
                              key={entry.id}
                              mangaId={entry.id}
                              readStatus={entry.status}
                              chapter={entry.chapter}
                              onRemove={() => removeManga(entry.id)}
                              onStatusChange={(s) => setStatus(entry.id, s)}
                              onChapterChange={(n) => setChapter(entry.id, n)}
                            />
                          ))}
                        </motion.div>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}

function EmptyState({
  icon, title, description, cta,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: { label: string; href: string };
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-32 text-center">
      <div className="w-20 h-20 border border-white/10 flex items-center justify-center mb-8">{icon}</div>
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

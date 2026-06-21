import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Search, X, Star, Loader2, ChevronDown, BookOpen, Bookmark, BookmarkCheck } from "lucide-react";
import { useMangaList, type ReadStatus } from "@/hooks/useMangaList";

const GENRES = [
  "Action","Adventure","Comedy","Drama","Fantasy","Horror",
  "Mystery","Psychological","Romance","Sci-Fi","Slice of Life",
  "Sports","Supernatural","Thriller","Seinen","Shounen","Shoujo","Josei",
];

const SORTS = [
  { label: "Popularity",  value: "POPULARITY_DESC" },
  { label: "Rating",      value: "SCORE_DESC" },
  { label: "Trending",    value: "TRENDING_DESC" },
  { label: "Newest",      value: "START_DATE_DESC" },
  { label: "Title A–Z",   value: "TITLE_ROMAJI" },
];

const FORMATS = [
  { label: "Manga",   value: "MANGA" },
  { label: "Manhwa",  value: "ONE_SHOT" },
  { label: "Novel",   value: "NOVEL" },
];

const STATUS_MAP: Record<string, string> = {
  FINISHED:         "Completed",
  RELEASING:        "Ongoing",
  NOT_YET_RELEASED: "Upcoming",
  CANCELLED:        "Cancelled",
  HIATUS:           "On Hiatus",
};

interface MangaMedia {
  id: number;
  title: { romaji: string; english?: string | null };
  coverImage: { large?: string; extraLarge?: string };
  genres: string[];
  averageScore?: number | null;
  status: string;
  startDate?: { year?: number | null } | null;
  format?: string | null;
  chapters?: number | null;
}

const QUERY = `
query ($search: String, $genre: String, $format: MediaFormat, $sort: [MediaSort], $page: Int) {
  Page(page: $page, perPage: 24) {
    pageInfo { hasNextPage total }
    media(
      type: MANGA
      search: $search
      genre: $genre
      format: $format
      sort: $sort
      isAdult: false
    ) {
      id
      title { romaji english }
      coverImage { extraLarge large }
      genres
      averageScore
      status
      startDate { year }
      format
      chapters
    }
  }
}`;

async function fetchManga(
  search: string,
  genre: string,
  format: string,
  sort: string,
  page: number
): Promise<{ items: MangaMedia[]; hasNextPage: boolean }> {
  const vars: Record<string, unknown> = { sort: [sort], page };
  if (search) vars.search = search;
  if (genre) vars.genre = genre;
  if (format) vars.format = format;

  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: vars }),
  });
  const json = await res.json();
  const page_data = json?.data?.Page;
  return {
    items: page_data?.media ?? [],
    hasNextPage: page_data?.pageInfo?.hasNextPage ?? false,
  };
}

function MangaCard({ manga, index, saved, onToggle }: { manga: MangaMedia; index: number; saved: boolean; onToggle: () => void }) {
  const cover = manga.coverImage?.extraLarge ?? manga.coverImage?.large ?? "";
  const title = manga.title.english ?? manga.title.romaji;
  const score = manga.averageScore ? (manga.averageScore / 10).toFixed(1) : null;
  const year = manga.startDate?.year;
  const status = STATUS_MAP[manga.status] ?? manga.status;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: (index % 24) * 0.02 }}
      className="group relative"
    >
      <Link href={`/manga/al/${manga.id}`}>
        <div className="relative cursor-pointer w-full aspect-[2/3] overflow-hidden border border-white/5 bg-zinc-950">
          {cover && (
            <img
              src={cover}
              alt={title}
              className="w-full h-full object-cover transition-all duration-700 group-hover:scale-110"
              loading="lazy"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />

          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
            style={{ boxShadow: "inset 0 0 60px rgba(255,255,255,0.07)" }}
          />

          <div className="absolute top-2 right-2 flex gap-1">
            {score && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-white/10 backdrop-blur-sm text-white text-[9px] font-mono border border-white/10">
                <Star className="w-2.5 h-2.5 fill-white/70 text-white/70" />
                {score}
              </span>
            )}
          </div>

          {/* Bookmark button */}
          <button
            onClick={(e) => { e.preventDefault(); onToggle(); }}
            className={`absolute top-2 left-2 z-10 w-7 h-7 flex items-center justify-center border transition-all duration-200 opacity-0 group-hover:opacity-100 ${
              saved
                ? "bg-white text-black border-white opacity-100"
                : "bg-black/60 text-white border-white/20 hover:bg-white hover:text-black hover:border-white"
            }`}
            title={saved ? "Remove from My List" : "Save to My List"}
          >
            {saved ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
          </button>

          <div className="absolute bottom-0 left-0 p-3 w-full">
            <h3 className="text-white font-serif text-sm leading-tight line-clamp-2 mb-1 drop-shadow-lg">
              {title}
            </h3>
            <div className="flex items-center gap-1.5 text-[9px] font-mono text-white/50 uppercase tracking-widest flex-wrap">
              {year && <span>{year}</span>}
              {year && <span className="w-0.5 h-0.5 rounded-full bg-white/30" />}
              <span>{status}</span>
              {manga.chapters && (
                <>
                  <span className="w-0.5 h-0.5 rounded-full bg-white/30" />
                  <span>{manga.chapters} ch</span>
                </>
              )}
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function MangaCardSkeleton() {
  return <div className="w-full aspect-[2/3] bg-white/[0.03] animate-pulse border border-white/5" />;
}

export default function MangaPage() {
  const { toggle, isInList, getStatus } = useMangaList();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [genre, setGenre] = useState("");
  const [format, setFormat] = useState("");
  const [sort, setSort] = useState("POPULARITY_DESC");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<MangaMedia[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async (reset: boolean) => {
    const p = reset ? 1 : page;
    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const data = await fetchManga(debouncedSearch, genre, format, sort, p);
      setItems(prev => reset ? data.items : [...prev, ...data.items]);
      setHasNextPage(data.hasNextPage);
      if (!reset) setPage(p + 1);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [debouncedSearch, genre, format, sort, page]);

  useEffect(() => {
    setPage(1);
    load(true);
  }, [debouncedSearch, genre, format, sort]);

  function clearFilters() {
    setSearch("");
    setGenre("");
    setFormat("");
    setSort("POPULARITY_DESC");
  }

  const hasActiveFilters = search || genre || format || sort !== "POPULARITY_DESC";

  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-20">
      {/* Header */}
      <div className="relative overflow-hidden border-b border-white/[0.06]">
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-6">
            <BookOpen className="w-5 h-5 text-white/40" />
            <h1 className="text-xl font-serif text-white tracking-wide">Manga</h1>
            <span className="text-white/15 text-xs font-mono">/ Browse</span>
          </div>

          {/* Search + filters row */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search manga, manhwa…"
                className="w-full pl-9 pr-4 py-2.5 bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors font-mono"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/60">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={sort}
                onChange={e => setSort(e.target.value)}
                className="px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] text-xs text-white/60 focus:outline-none focus:border-white/20 font-mono cursor-pointer"
              >
                {SORTS.map(s => (
                  <option key={s.value} value={s.value} className="bg-zinc-900">{s.label}</option>
                ))}
              </select>

              <button
                onClick={() => setShowFilters(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-2.5 border text-xs font-mono uppercase tracking-widest transition-colors ${showFilters || genre || format ? "border-white/30 text-white bg-white/[0.06]" : "border-white/[0.08] text-white/40 hover:border-white/20 hover:text-white/70"}`}
              >
                Filters
                <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? "rotate-180" : ""}`} />
              </button>

              {hasActiveFilters && (
                <button onClick={clearFilters} className="px-3 py-2.5 text-xs font-mono text-white/30 hover:text-white/60 border border-white/[0.05] hover:border-white/15 transition-colors uppercase tracking-widest">
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Filter drawer */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="pt-4 space-y-4">
                  <div>
                    <p className="text-[10px] font-mono text-white/25 uppercase tracking-widest mb-2">Format</p>
                    <div className="flex flex-wrap gap-1.5">
                      {FORMATS.map(f => (
                        <button
                          key={f.value}
                          onClick={() => setFormat(format === f.value ? "" : f.value)}
                          className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest border transition-colors ${format === f.value ? "border-white/40 text-white bg-white/[0.08]" : "border-white/[0.07] text-white/35 hover:border-white/20 hover:text-white/60"}`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-mono text-white/25 uppercase tracking-widest mb-2">Genre</p>
                    <div className="flex flex-wrap gap-1.5">
                      {GENRES.map(g => (
                        <button
                          key={g}
                          onClick={() => setGenre(genre === g ? "" : g)}
                          className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest border transition-colors ${genre === g ? "border-white/40 text-white bg-white/[0.08]" : "border-white/[0.07] text-white/35 hover:border-white/20 hover:text-white/60"}`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-7xl mx-auto px-6 pt-8">
        {loading ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
            {Array.from({ length: 24 }).map((_, i) => <MangaCardSkeleton key={i} />)}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <BookOpen className="w-10 h-10 text-white/10" />
            <p className="text-white/25 font-mono text-sm uppercase tracking-widest">No manga found</p>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="text-white/40 hover:text-white/70 text-xs font-mono uppercase tracking-widest border border-white/10 hover:border-white/25 px-3 py-1.5 transition-colors">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
            {items.map((manga, i) => (
              <MangaCard key={manga.id} manga={manga} index={i} saved={isInList(manga.id)} onToggle={() => toggle(manga.id)} />
            ))}
          </div>
        )}

        {/* Load more */}
        {hasNextPage && !loading && (
          <div className="flex justify-center mt-10">
            <button
              onClick={() => { setPage(p => p + 1); load(false); }}
              disabled={loadingMore}
              className="flex items-center gap-2 px-6 py-3 border border-white/10 text-white/40 hover:text-white/80 hover:border-white/25 text-xs font-mono uppercase tracking-widest transition-colors disabled:opacity-40"
            >
              {loadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

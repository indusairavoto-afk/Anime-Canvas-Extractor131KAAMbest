import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { Search, SlidersHorizontal, X, Star, Loader2, ChevronDown, ArrowRight } from "lucide-react";

const GENRES = [
  "Action","Adventure","Comedy","Drama","Fantasy","Horror","Mecha",
  "Music","Mystery","Psychological","Romance","Sci-Fi","Slice of Life",
  "Sports","Supernatural","Thriller",
];

const SORTS = [
  { label: "Popularity",   value: "POPULARITY_DESC" },
  { label: "Rating",       value: "SCORE_DESC" },
  { label: "Trending",     value: "TRENDING_DESC" },
  { label: "Newest",       value: "START_DATE_DESC" },
  { label: "Oldest",       value: "START_DATE" },
  { label: "Title A–Z",   value: "TITLE_ROMAJI" },
];

const FORMATS = [
  { label: "TV Series", value: "TV" },
  { label: "Movie",     value: "MOVIE" },
  { label: "OVA",       value: "OVA" },
  { label: "ONA",       value: "ONA" },
  { label: "Special",   value: "SPECIAL" },
];

const STATUS_MAP: Record<string, string> = {
  FINISHED:        "Completed",
  RELEASING:       "Ongoing",
  NOT_YET_RELEASED:"Upcoming",
  CANCELLED:       "Cancelled",
  HIATUS:          "On Hiatus",
};

interface AniMedia {
  id: number;
  title: { romaji: string; english?: string | null };
  coverImage: { extraLarge?: string; large?: string };
  bannerImage?: string | null;
  genres: string[];
  averageScore?: number | null;
  status: string;
  seasonYear?: number | null;
  format?: string | null;
  episodes?: number | null;
  studios?: { nodes: { name: string }[] };
}

const QUERY = `
query ($search: String, $genre: String, $format: MediaFormat, $sort: [MediaSort], $page: Int) {
  Page(page: $page, perPage: 24) {
    pageInfo { hasNextPage total }
    media(
      type: ANIME
      search: $search
      genre: $genre
      format: $format
      sort: $sort
      isAdult: false
    ) {
      id
      title { romaji english }
      coverImage { extraLarge large }
      bannerImage
      genres
      averageScore
      status
      seasonYear
      format
      episodes
      studios(isMain: true) { nodes { name } }
    }
  }
}`;

async function fetchAnime(
  search: string,
  genre: string,
  format: string,
  sort: string,
  page: number
): Promise<{ media: AniMedia[]; hasNextPage: boolean; total: number }> {
  const variables: Record<string, unknown> = { sort: [sort], page };
  if (search.trim()) variables.search = search.trim();
  if (genre) variables.genre = genre;
  if (format) variables.format = format;

  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables }),
  });
  const json = await res.json();
  return {
    media: json?.data?.Page?.media ?? [],
    hasNextPage: json?.data?.Page?.pageInfo?.hasNextPage ?? false,
    total: json?.data?.Page?.pageInfo?.total ?? 0,
  };
}

function AniCard({ item, index }: { item: AniMedia; index: number }) {
  const cover = item.coverImage?.extraLarge || item.coverImage?.large || "";
  const title = item.title.english || item.title.romaji;
  const score = item.averageScore ? (item.averageScore / 10).toFixed(1) : null;

  return (
    <Link href={`/anime/al/${item.id}`}>
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.03, 0.5) }}
      className="group relative block cursor-pointer"
    >
      <div className="relative w-full aspect-[2/3] border border-white/5 bg-zinc-950 overflow-hidden">
        {cover && (
          <img
            src={cover}
            alt={title}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />

        {/* hover overlay */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/20 flex items-center justify-center">
          <ArrowRight className="w-5 h-5 text-white/70" />
        </div>

        {/* badges */}
        <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
          {item.format && (
            <span className="px-1.5 py-0.5 bg-white/10 backdrop-blur-sm text-white text-[8px] font-mono uppercase tracking-widest border border-white/10">
              {item.format}
            </span>
          )}
          {score && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-black/70 backdrop-blur-sm text-white text-[9px] font-mono border border-white/10">
              <Star className="w-2.5 h-2.5 fill-white/60 text-white/60" />{score}
            </span>
          )}
        </div>

        {/* info */}
        <div className="absolute bottom-0 left-0 p-3 w-full">
          <h3 className="text-white font-serif text-sm leading-tight line-clamp-2 mb-1 drop-shadow-lg">
            {title}
          </h3>
          <div className="flex items-center gap-1.5 text-[9px] font-mono text-white/50 uppercase tracking-widest flex-wrap">
            {item.seasonYear && <span>{item.seasonYear}</span>}
            {item.seasonYear && <span className="w-0.5 h-0.5 rounded-full bg-white/30" />}
            <span className={item.status === "RELEASING" ? "text-white/70" : ""}>
              {STATUS_MAP[item.status] ?? item.status}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
    </Link>
  );
}

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.03 } } };

export default function Browse() {
  const [search, setSearch]       = useState("");
  const [genre, setGenre]         = useState("");
  const [format, setFormat]       = useState("");
  const [sort, setSort]           = useState("POPULARITY_DESC");
  const [showFilters, setShowFilters] = useState(false);

  const [items, setItems]         = useState<AniMedia[]>([]);
  const [page, setPage]           = useState(1);
  const [total, setTotal]         = useState(0);
  const [hasMore, setHasMore]     = useState(false);
  const [loading, setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]);

  // Fetch on filter change — reset to page 1
  useEffect(() => {
    setLoading(true);
    setPage(1);
    setItems([]);
    fetchAnime(debouncedSearch, genre, format, sort, 1).then(({ media, hasNextPage, total }) => {
      setItems(media);
      setHasMore(hasNextPage);
      setTotal(total);
      setLoading(false);
    });
  }, [debouncedSearch, genre, format, sort]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    fetchAnime(debouncedSearch, genre, format, sort, nextPage).then(({ media, hasNextPage }) => {
      setItems((prev) => [...prev, ...media]);
      setHasMore(hasNextPage);
      setPage(nextPage);
      setLoadingMore(false);
    });
  }, [loadingMore, hasMore, page, debouncedSearch, genre, format, sort]);

  // Infinite scroll observer
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { threshold: 0.1 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [loadMore]);

  const activeFilters = [genre, format].filter(Boolean);
  const activeSort = SORTS.find((s) => s.value === sort);

  return (
    <div className="bg-black text-white min-h-screen">
      {/* Header */}
      <div className="border-b border-white/5 pt-8 sm:pt-12 pb-6 sm:pb-8 px-4 sm:px-8 lg:px-16">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-end justify-between mb-5 sm:mb-6">
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="font-serif text-4xl sm:text-5xl text-white"
            >
              Browse
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="text-white/20 font-mono text-[10px] uppercase tracking-widest hidden sm:block"
            >
              Powered by AniList · 5000+ titles
            </motion.p>
          </div>

          {/* Search + filter row */}
          <div className="flex gap-2 sm:gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search any anime…"
                className="w-full bg-white/[0.04] border border-white/10 text-white pl-10 pr-4 py-3 text-sm placeholder:text-white/30 focus:outline-none focus:border-white/30 transition-colors"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Sort dropdown */}
            <div className="relative hidden sm:block">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="appearance-none bg-white/[0.04] border border-white/10 text-white/70 text-[11px] font-mono uppercase tracking-widest pl-3 pr-8 py-3 focus:outline-none focus:border-white/30 cursor-pointer hover:border-white/20 transition-colors"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value} className="bg-zinc-950 text-white">
                    {s.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
            </div>

            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 border px-4 py-3 text-sm font-mono uppercase tracking-widest transition-colors flex-shrink-0 ${
                showFilters ? "border-white bg-white text-black" : "border-white/10 text-white/60 hover:border-white/30 hover:text-white"
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span className="hidden sm:inline">Filters</span>
              {activeFilters.length > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 ${showFilters ? "bg-black text-white" : "bg-white text-black"}`}>
                  {activeFilters.length}
                </span>
              )}
            </button>
          </div>

          {/* Filter panel */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 space-y-4 overflow-hidden"
              >
                {/* Genre */}
                <div>
                  <p className="text-[9px] font-mono text-white/30 uppercase tracking-[0.3em] mb-2">Genre</p>
                  <div className="flex flex-wrap gap-1.5">
                    {GENRES.map((g) => (
                      <button
                        key={g}
                        onClick={() => setGenre(genre === g ? "" : g)}
                        className={`text-[10px] font-mono uppercase tracking-widest border px-2.5 py-1.5 transition-all ${
                          genre === g ? "border-white bg-white text-black" : "border-white/10 text-white/50 hover:border-white/30 hover:text-white"
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Format */}
                <div>
                  <p className="text-[9px] font-mono text-white/30 uppercase tracking-[0.3em] mb-2">Format</p>
                  <div className="flex flex-wrap gap-1.5">
                    {FORMATS.map((f) => (
                      <button
                        key={f.value}
                        onClick={() => setFormat(format === f.value ? "" : f.value)}
                        className={`text-[10px] font-mono uppercase tracking-widest border px-2.5 py-1.5 transition-all ${
                          format === f.value ? "border-white bg-white text-black" : "border-white/10 text-white/50 hover:border-white/30 hover:text-white"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sort (mobile) */}
                <div className="sm:hidden">
                  <p className="text-[9px] font-mono text-white/30 uppercase tracking-[0.3em] mb-2">Sort By</p>
                  <div className="flex flex-wrap gap-1.5">
                    {SORTS.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => setSort(s.value)}
                        className={`text-[10px] font-mono uppercase tracking-widest border px-2.5 py-1.5 transition-all ${
                          sort === s.value ? "border-white bg-white text-black" : "border-white/10 text-white/50 hover:border-white/30 hover:text-white"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Active filters */}
                {(activeFilters.length > 0) && (
                  <div className="flex gap-2 flex-wrap pt-1">
                    {genre && (
                      <button onClick={() => setGenre("")} className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest bg-white/10 text-white px-3 py-1.5 hover:bg-white/20 transition-colors">
                        {genre} <X className="w-3 h-3" />
                      </button>
                    )}
                    {format && (
                      <button onClick={() => setFormat("")} className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest bg-white/10 text-white px-3 py-1.5 hover:bg-white/20 transition-colors">
                        {FORMATS.find(f => f.value === format)?.label} <X className="w-3 h-3" />
                      </button>
                    )}
                    <button onClick={() => { setGenre(""); setFormat(""); }} className="text-[10px] font-mono uppercase tracking-widest text-white/40 hover:text-white transition-colors px-2">
                      Clear all
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-16 py-6 sm:py-10">
        <div className="flex items-center justify-between mb-5">
          <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest">
            {loading
              ? "Searching…"
              : total > 0
                ? `${total.toLocaleString()} titles · sorted by ${activeSort?.label}`
                : "No results"}
          </p>
          {!loading && activeFilters.length === 0 && !debouncedSearch && (
            <p className="text-[9px] font-mono text-white/15 uppercase tracking-widest hidden sm:block">
              Click any card to view on AniList
            </p>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-4">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="w-full aspect-[2/3] bg-white/[0.03] animate-pulse border border-white/5" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-32">
            <p className="text-white/20 font-mono text-sm">No anime found</p>
            <button onClick={() => { setSearch(""); setGenre(""); setFormat(""); }} className="mt-4 text-[10px] font-mono uppercase tracking-widest text-white/30 hover:text-white border border-white/10 px-4 py-2 transition-colors">
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-4">
              {items.map((item, i) => (
                <AniCard key={`${item.id}-${i}`} item={item} index={i % 24} />
              ))}
            </div>

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="mt-10 flex justify-center">
              {loadingMore && (
                <div className="flex items-center gap-2 text-white/30">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-[10px] font-mono uppercase tracking-widest">Loading more…</span>
                </div>
              )}
              {!hasMore && items.length > 0 && (
                <p className="text-[10px] font-mono text-white/15 uppercase tracking-widest">
                  All {total.toLocaleString()} results loaded
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

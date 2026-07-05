import { motion } from "framer-motion";
import { anilistFetch } from "@/lib/api";
import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { Search, X, Star, Loader2, Mic, Play } from "lucide-react";
import { NexaBadge } from "@/components/NexaBadge";

const GENRES = [
  "Action","Adventure","Comedy","Drama","Fantasy","Horror","Mecha",
  "Music","Mystery","Psychological","Romance","Sci-Fi","Slice of Life",
  "Sports","Supernatural","Thriller",
];

const SORTS = [
  { label: "Most Popular",  value: "POPULARITY_DESC" },
  { label: "Top Rated",     value: "SCORE_DESC" },
  { label: "Trending",      value: "TRENDING_DESC" },
  { label: "Newest",        value: "START_DATE_DESC" },
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
  genres: string[];
  averageScore?: number | null;
  status: string;
  seasonYear?: number | null;
  format?: string | null;
  episodes?: number | null;
}

const QUERY = `
query ($search: String, $genre: String, $sort: [MediaSort], $page: Int) {
  Page(page: $page, perPage: 24) {
    pageInfo { hasNextPage total }
    media(
      type: ANIME
      search: $search
      genre: $genre
      sort: $sort
      isAdult: false
      format_in: [TV, MOVIE, OVA, ONA]
    ) {
      id
      title { romaji english }
      coverImage { extraLarge large }
      genres
      averageScore
      status
      seasonYear
      format
      episodes
    }
  }
}`;

async function fetchAnime(
  search: string,
  genre: string,
  sort: string,
  page: number
): Promise<{ media: AniMedia[]; hasNextPage: boolean; total: number }> {
  const variables: Record<string, unknown> = { sort: [sort], page };
  if (search.trim()) variables.search = search.trim();
  if (genre) variables.genre = genre;

  const json = await anilistFetch({ query: QUERY, variables });
  return {
    media: (json as any)?.data?.Page?.media ?? [],
    hasNextPage: (json as any)?.data?.Page?.pageInfo?.hasNextPage ?? false,
    total: (json as any)?.data?.Page?.pageInfo?.total ?? 0,
  };
}

function DubCard({ item, index }: { item: AniMedia; index: number }) {
  const cover = item.coverImage?.extraLarge || item.coverImage?.large || "";
  const title = item.title.english || item.title.romaji;
  const score = item.averageScore ? (item.averageScore / 10).toFixed(1) : null;

  return (
    <Link href={`/watch/al/${item.id}/1?lang=DUB`}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: Math.min(index * 0.03, 0.5) }}
        className="group relative block cursor-pointer"
      >
        <div className="relative w-full aspect-[2/3] bg-zinc-950 overflow-hidden border border-white/5">
          {cover && (
            <img
              src={cover}
              alt={title}
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />

          {/* hover play overlay */}
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/30 flex items-center justify-center">
            <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 px-3 py-1.5 rounded-full">
              <Play className="w-3.5 h-3.5 text-white fill-white" />
              <span className="text-white text-[10px] font-mono uppercase tracking-widest">Watch DUB</span>
            </div>
          </div>

          {/* DUB badge top-left */}
          <div className="absolute top-2 left-2">
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-white text-black text-[8px] font-bold uppercase tracking-widest">
              <Mic className="w-2.5 h-2.5" />
              DUB
            </span>
          </div>

          {/* score badge top-right */}
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

          {/* info bottom */}
          <div className="absolute bottom-0 left-0 p-3 w-full">
            <h3 className="text-white font-serif text-sm leading-tight line-clamp-2 mb-1 drop-shadow-lg">
              {title}
            </h3>
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 text-[9px] font-mono text-white/50 uppercase tracking-widest flex-wrap">
                {item.seasonYear && <span>{item.seasonYear}</span>}
                {item.seasonYear && <span className="w-0.5 h-0.5 rounded-full bg-white/30" />}
                <span className={item.status === "RELEASING" ? "text-white/70" : ""}>
                  {STATUS_MAP[item.status] ?? item.status}
                </span>
              </div>
              <NexaBadge animeId={item.id} />
            </div>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}

export default function Dubbed() {
  const [search, setSearch]   = useState("");
  const [genre, setGenre]     = useState("");
  const [sort, setSort]       = useState("POPULARITY_DESC");

  const [items, setItems]     = useState<AniMedia[]>([]);
  const [page, setPage]       = useState(1);
  const [total, setTotal]     = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]);

  useEffect(() => {
    setLoading(true);
    setPage(1);
    setItems([]);
    fetchAnime(debouncedSearch, genre, sort, 1).then(({ media, hasNextPage, total }) => {
      setItems(media);
      setHasMore(hasNextPage);
      setTotal(total);
      setLoading(false);
    });
  }, [debouncedSearch, genre, sort]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    fetchAnime(debouncedSearch, genre, sort, nextPage).then(({ media, hasNextPage }) => {
      setItems((prev) => [...prev, ...media]);
      setHasMore(hasNextPage);
      setPage(nextPage);
      setLoadingMore(false);
    });
  }, [loadingMore, hasMore, page, debouncedSearch, genre, sort]);

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

  return (
    <div className="bg-black text-white min-h-screen">
      {/* Header */}
      <div className="border-b border-white/5 pt-8 sm:pt-12 pb-6 sm:pb-8 px-4 sm:px-8 lg:px-16">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-end justify-between mb-5 sm:mb-6">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="flex items-center gap-3 mb-1">
                <span className="flex items-center gap-1.5 px-2 py-1 bg-white text-black text-[9px] font-bold uppercase tracking-widest">
                  <Mic className="w-3 h-3" />
                  DUB
                </span>
                <span className="text-white/20 font-mono text-[10px] uppercase tracking-widest">
                  English Audio
                </span>
              </div>
              <h1 className="font-serif text-4xl sm:text-5xl text-white">
                Dubbed Anime
              </h1>
            </motion.div>
            {total > 0 && !loading && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15 }}
                className="text-white/20 font-mono text-[10px] uppercase tracking-widest hidden sm:block"
              >
                {total.toLocaleString()} titles
              </motion.p>
            )}
          </div>

          {/* Search bar */}
          <div className="flex gap-2 sm:gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search dubbed anime…"
                className="w-full bg-white/[0.04] border border-white/10 text-white pl-10 pr-4 py-3 text-sm placeholder:text-white/30 focus:outline-none focus:border-white/30 transition-colors"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Sort */}
            <div className="relative">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="appearance-none bg-white/[0.04] border border-white/10 text-white/70 text-[11px] font-mono uppercase tracking-widest pl-3 pr-8 py-3 focus:outline-none focus:border-white/30 cursor-pointer hover:border-white/20 transition-colors h-full"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value} className="bg-zinc-900">
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Genre chips */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setGenre("")}
              className={`px-3 py-1 text-[10px] font-mono uppercase tracking-widest border transition-colors ${
                !genre
                  ? "bg-white text-black border-white"
                  : "bg-transparent text-white/40 border-white/10 hover:border-white/30 hover:text-white/70"
              }`}
            >
              All
            </button>
            {GENRES.map((g) => (
              <button
                key={g}
                onClick={() => setGenre(genre === g ? "" : g)}
                className={`px-3 py-1 text-[10px] font-mono uppercase tracking-widest border transition-colors ${
                  genre === g
                    ? "bg-white text-black border-white"
                    : "bg-transparent text-white/40 border-white/10 hover:border-white/30 hover:text-white/70"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="px-4 sm:px-8 lg:px-16 py-8">
        <div className="max-w-7xl mx-auto">
          {loading ? (
            <div className="flex items-center justify-center py-32">
              <Loader2 className="w-6 h-6 animate-spin text-white/30" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32 gap-3">
              <Mic className="w-10 h-10 text-white/10" />
              <p className="text-white/30 font-mono text-sm uppercase tracking-widest">No results found</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-3">
              {items.map((item, i) => (
                <DubCard key={item.id} item={item} index={i} />
              ))}
            </div>
          )}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-10 mt-8 flex items-center justify-center">
            {loadingMore && <Loader2 className="w-5 h-5 animate-spin text-white/20" />}
          </div>
        </div>
      </div>
    </div>
  );
}

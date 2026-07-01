import { useState, useEffect, useRef } from "react";
import { Link, useSearch } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { apiUrl } from "@/lib/api";
import { Newspaper, ChevronLeft, ChevronRight, Calendar, Search, X } from "lucide-react";

interface ArticleSummary {
  slug: string;
  title: string;
  url: string;
  image: string;
  author: string;
  date: string;
  categories: string[];
}

const CATEGORIES = [
  { label: "All News", slug: "news" },
  { label: "Anime News", slug: "anime-news" },
  { label: "Manga News", slug: "manga-news" },
  { label: "Seasonal", slug: "seasonal" },
];

function ArticleCard({ article, index, query }: { article: ArticleSummary; index: number; query: string }) {
  const title = article.title;
  const highlighted = query.trim()
    ? title.replace(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>")
    : title;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link href={`/news/${article.slug}`}>
        <div className="group cursor-pointer bg-zinc-900/50 border border-white/5 hover:border-white/20 transition-all duration-300 overflow-hidden rounded-2xl h-full flex flex-col">
          <div className="relative aspect-video overflow-hidden flex-shrink-0">
            {article.image ? (
              <img
                src={article.image}
                alt={article.title}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                <Newspaper className="w-8 h-8 text-white/10" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            {article.categories.length > 0 && (
              <div className="absolute top-2 left-2 flex flex-wrap gap-1">
                {article.categories.slice(0, 2).map((cat) => (
                  <span key={cat} className="text-[8px] font-mono uppercase tracking-widest bg-red-600 text-white px-1.5 py-0.5">
                    {cat}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="p-3 sm:p-4 flex flex-col gap-1 flex-1">
            <h3
              className="font-semibold text-white text-sm leading-snug line-clamp-2 group-hover:text-white/80 transition-colors [&_mark]:bg-yellow-400/30 [&_mark]:text-yellow-200 [&_mark]:not-italic"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
            {article.date && (
              <span className="flex items-center gap-1 text-[10px] font-mono text-white/30 mt-auto pt-1">
                <Calendar className="w-2.5 h-2.5 flex-shrink-0" /> {article.date}
              </span>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl overflow-hidden bg-zinc-900/50 border border-white/5 animate-pulse">
      <div className="aspect-video bg-white/5" />
      <div className="p-3 sm:p-4 space-y-2">
        <div className="h-4 bg-white/5 rounded w-full" />
        <div className="h-4 bg-white/5 rounded w-2/3" />
        <div className="h-3 bg-white/5 rounded w-1/3 mt-3" />
      </div>
    </div>
  );
}

export default function NewsPage() {
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);
  const initialCategory = params.get("category") || "anime-news";

  const [category, setCategory] = useState(initialCategory);
  const [page, setPage] = useState(1);
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasNextPage, setHasNextPage] = useState(false);

  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(apiUrl(`/api/animecorner/news?category=${category}&page=${page}`))
      .then((r) => r.json())
      .then((data) => {
        setArticles(data.articles || []);
        setHasNextPage(data.hasNextPage || false);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [category, page]);

  function changeCategory(cat: string) {
    setCategory(cat);
    setPage(1);
    setArticles([]);
    setQuery("");
  }

  const filtered = query.trim()
    ? articles.filter((a) => a.title.toLowerCase().includes(query.toLowerCase()))
    : articles;

  const isSearching = query.trim().length > 0;

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <div className="px-4 sm:px-6 pt-8 pb-6 border-b border-white/5">
        <div className="max-w-6xl mx-auto">
          <p className="text-[9px] font-mono text-white/30 uppercase tracking-[0.3em] mb-1 flex items-center gap-1.5">
            <Newspaper className="w-3 h-3" /> Latest
          </p>
          <div className="flex flex-col sm:flex-row sm:items-end gap-4 mb-6">
            <h1 className="font-serif text-3xl sm:text-4xl text-white leading-none">Anime News</h1>

            {/* Search bar */}
            <div className={`relative flex-1 sm:max-w-xs transition-all duration-300 ${searchFocused ? "sm:max-w-sm" : ""}`}>
              <div className={`flex items-center gap-2 border px-3 py-1.5 transition-all duration-200 rounded-lg ${
                searchFocused ? "border-white/30 bg-white/5" : "border-white/10 bg-transparent"
              }`}>
                <Search className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  placeholder="Search articles…"
                  className="flex-1 bg-transparent text-[11px] font-mono text-white placeholder-white/20 outline-none min-w-0"
                />
                <AnimatePresence>
                  {query && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.7 }}
                      onClick={() => { setQuery(""); inputRef.current?.focus(); }}
                      className="text-white/25 hover:text-white/60 transition-colors flex-shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Category tabs — hidden while searching */}
          <AnimatePresence>
            {!isSearching && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex gap-1 overflow-x-auto"
                style={{ scrollbarWidth: "none" }}
              >
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.slug}
                    onClick={() => changeCategory(cat.slug)}
                    className={`flex-shrink-0 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-all ${
                      category === cat.slug
                        ? "bg-white text-black"
                        : "text-white/30 border border-white/10 hover:border-white/30 hover:text-white"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Search result count */}
          <AnimatePresence>
            {isSearching && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[10px] font-mono text-white/30 uppercase tracking-widest"
              >
                {filtered.length === 0 ? "No results" : `${filtered.length} result${filtered.length !== 1 ? "s" : ""} for "${query}"`}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {filtered.length === 0 && !loading && isSearching ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-24 gap-3"
          >
            <Search className="w-8 h-8 text-white/10" />
            <p className="text-white/25 font-mono text-sm">No articles match "{query}"</p>
            <button
              onClick={() => setQuery("")}
              className="text-[10px] font-mono uppercase tracking-widest text-white/30 hover:text-white border border-white/10 hover:border-white/30 px-3 py-1.5 transition-all"
            >
              Clear search
            </button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {loading
              ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
              : filtered.map((a, i) => <ArticleCard key={a.slug} article={a} index={i} query={query} />)}
          </div>
        )}

        {/* Pagination — hidden while searching */}
        {!loading && !isSearching && (
          <div className="flex items-center justify-center gap-3 mt-10">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-mono uppercase tracking-widest border border-white/10 text-white/30 hover:border-white/30 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3 h-3" /> Prev
            </button>
            <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Page {page}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasNextPage}
              className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-mono uppercase tracking-widest border border-white/10 text-white/30 hover:border-white/30 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

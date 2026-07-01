import { useState, useEffect } from "react";
import { Link, useSearch } from "wouter";
import { motion } from "framer-motion";
import { apiUrl } from "@/lib/api";
import { Newspaper, ChevronLeft, ChevronRight, Calendar, User, ExternalLink } from "lucide-react";

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

function ArticleCard({ article, index }: { article: ArticleSummary; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link href={`/news/${article.slug}`}>
        <div className="group cursor-pointer bg-zinc-900/50 border border-white/5 hover:border-white/20 transition-all duration-300 overflow-hidden rounded-2xl">
          <div className="relative aspect-video overflow-hidden">
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
                  <span
                    key={cat}
                    className="text-[8px] font-mono uppercase tracking-widest bg-red-600 text-white px-1.5 py-0.5"
                  >
                    {cat}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="p-3 sm:p-4">
            <h3 className="font-semibold text-white text-sm leading-snug line-clamp-2 mb-2 group-hover:text-white/80 transition-colors">
              {article.title}
            </h3>
            <div className="flex items-center gap-3 text-[10px] font-mono text-white/30">
              {article.author && (
                <span className="flex items-center gap-1 truncate">
                  <User className="w-2.5 h-2.5 flex-shrink-0" /> {article.author}
                </span>
              )}
              {article.date && (
                <span className="flex items-center gap-1 whitespace-nowrap">
                  <Calendar className="w-2.5 h-2.5 flex-shrink-0" /> {article.date}
                </span>
              )}
            </div>
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
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <div className="px-4 sm:px-6 pt-8 pb-6 border-b border-white/5">
        <div className="max-w-6xl mx-auto">
          <p className="text-[9px] font-mono text-white/30 uppercase tracking-[0.3em] mb-1 flex items-center gap-1.5">
            <Newspaper className="w-3 h-3" /> Latest
          </p>
          <h1 className="font-serif text-3xl sm:text-4xl text-white leading-none mb-6">Anime News</h1>

          {/* Category tabs */}
          <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
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
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {loading
            ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
            : articles.map((a, i) => <ArticleCard key={a.slug} article={a} index={i} />)}
        </div>

        {/* Pagination */}
        {!loading && (
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

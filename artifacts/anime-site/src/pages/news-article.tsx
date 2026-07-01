import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { motion } from "framer-motion";
import { apiUrl } from "@/lib/api";
import { ArrowLeft, Calendar, Tag, ExternalLink, Clock } from "lucide-react";

interface RelatedArticle {
  slug: string;
  title: string;
  image: string;
  author: string;
  date: string;
  categories: string[];
}

interface ArticleFull {
  slug: string;
  title: string;
  url: string;
  image: string;
  author: string;
  date: string;
  publishedAt: string;
  categories: string[];
  description: string;
  content: string;
  tags: string[];
  related: RelatedArticle[];
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ArticleSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="w-full aspect-video bg-white/5 mb-8" />
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <div className="h-3 w-24 bg-white/10 mb-4 rounded" />
        <div className="h-8 bg-white/10 mb-3 rounded" />
        <div className="h-8 w-3/4 bg-white/10 mb-6 rounded" />
        <div className="flex gap-3 mb-8">
          <div className="h-4 w-28 bg-white/10 rounded" />
          <div className="h-4 w-20 bg-white/10 rounded" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-4 bg-white/5 mb-3 rounded" style={{ width: `${80 + Math.random() * 20}%` }} />
        ))}
      </div>
    </div>
  );
}

export default function NewsArticle() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [article, setArticle] = useState<ArticleFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    fetch(apiUrl(`/api/animecorner/article/${slug}`))
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setArticle(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load article");
        setLoading(false);
      });
  }, [slug]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Back nav */}
      <div className="sticky top-14 z-10 bg-zinc-950/90 backdrop-blur-md border-b border-white/5 px-4 sm:px-6 py-3">
        <Link href="/news">
          <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/40 hover:text-white transition-colors w-fit cursor-pointer">
            <ArrowLeft className="w-3 h-3" /> Back to News
          </span>
        </Link>
      </div>

      {loading && <ArticleSkeleton />}

      {error && (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center">
          <p className="text-white/40 font-mono text-sm">{error}</p>
          <Link href="/news">
            <span className="mt-4 inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/30 hover:text-white transition-colors cursor-pointer">
              <ArrowLeft className="w-3 h-3" /> Back to News
            </span>
          </Link>
        </div>
      )}

      {!loading && !error && article && (
        <motion.article
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          {/* Hero image */}
          {article.image && (
            <div className="relative w-full aspect-video sm:aspect-[21/8] overflow-hidden bg-zinc-900">
              <img
                src={article.image}
                alt={article.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent" />
              {/* Categories over image */}
              <div className="absolute bottom-4 left-4 sm:left-8 flex flex-wrap gap-1.5">
                {article.categories.slice(0, 3).map((cat) => (
                  <Link key={cat} href={`/news?category=${cat.toLowerCase().replace(/\s+/g, "-")}`}>
                    <span className="text-[9px] font-mono uppercase tracking-widest bg-red-600 text-white px-2 py-0.5 cursor-pointer hover:bg-red-500 transition-colors">
                      {cat}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Article content */}
          <div className="max-w-3xl mx-auto px-4 sm:px-8 py-8">
            {/* Title */}
            <h1 className="font-serif text-2xl sm:text-4xl text-white leading-tight mb-4">
              {article.title}
            </h1>

            {/* Description */}
            {article.description && (
              <p className="text-base sm:text-lg text-white/60 leading-relaxed mb-6 border-l-2 border-red-600 pl-4">
                {article.description}
              </p>
            )}

            {/* Meta */}
            <div className="flex flex-wrap items-center gap-4 mb-8 pb-6 border-b border-white/10">
              {(article.publishedAt || article.date) && (
                <span className="flex items-center gap-1.5 text-xs text-white/40">
                  <Calendar className="w-3 h-3" />
                  {article.date || new Date(article.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </span>
              )}
              {article.publishedAt && (
                <span className="flex items-center gap-1.5 text-xs text-white/30">
                  <Clock className="w-3 h-3" />
                  {timeAgo(article.publishedAt)}
                </span>
              )}
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-white/25 hover:text-white/60 transition-colors ml-auto"
              >
                Source <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Body content */}
            {article.content ? (
              <div
                className="news-article-body prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: article.content }}
              />
            ) : (
              <p className="text-white/40 font-mono text-sm">No content available. <a href={article.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-white transition-colors">Read on Anime Corner ↗</a></p>
            )}

            {/* Tags */}
            {article.tags.length > 0 && (
              <div className="mt-10 pt-6 border-t border-white/10">
                <p className="text-[9px] font-mono uppercase tracking-widest text-white/30 mb-3 flex items-center gap-1.5">
                  <Tag className="w-3 h-3" /> Tags
                </p>
                <div className="flex flex-wrap gap-2">
                  {article.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] font-mono uppercase tracking-widest text-white/30 border border-white/10 px-2 py-1 hover:border-white/30 hover:text-white/60 transition-colors cursor-default"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Back link */}
            <div className="mt-10 pt-6 border-t border-white/5">
              <Link href="/news">
                <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/30 hover:text-white transition-colors cursor-pointer w-fit">
                  <ArrowLeft className="w-3 h-3" /> All News
                </span>
              </Link>
            </div>
          </div>

          {/* Related Articles */}
          {article.related && article.related.length > 0 && (
            <div className="border-t border-white/8 mt-4 py-12 px-4 sm:px-8 bg-zinc-900/40">
              <div className="max-w-5xl mx-auto">
                <p className="text-[9px] font-mono uppercase tracking-widest text-white/30 mb-6">More Articles</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {article.related.map((rel, idx) => (
                    <motion.div
                      key={rel.slug}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, delay: idx * 0.07 }}
                    >
                      <Link href={`/news/${rel.slug}`}>
                        <div className="group cursor-pointer rounded-xl overflow-hidden bg-zinc-800/60 hover:bg-zinc-800 border border-white/5 hover:border-white/15 transition-all duration-300 flex flex-col h-full">
                          {rel.image && (
                            <div className="relative aspect-video overflow-hidden flex-shrink-0">
                              <img
                                src={rel.image}
                                alt={rel.title}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                loading="lazy"
                              />
                            </div>
                          )}
                          <div className="p-3 flex flex-col gap-1 flex-1">
                            <p className="text-[9px] font-mono text-white/30 uppercase tracking-widest">{rel.date}</p>
                            <h4 className="text-sm font-semibold text-white/85 group-hover:text-white leading-snug line-clamp-2 transition-colors">
                              {rel.title}
                            </h4>
                          </div>
                        </div>
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </motion.article>
      )}

      <style>{`
        .news-article-body p {
          color: rgba(255,255,255,0.75);
          line-height: 1.8;
          margin-bottom: 1.25rem;
          font-size: 0.95rem;
        }
        .news-article-body h2 {
          color: white;
          font-size: 1.35rem;
          font-weight: 700;
          margin-top: 2rem;
          margin-bottom: 0.75rem;
          border-left: 3px solid #dc2626;
          padding-left: 0.75rem;
        }
        .news-article-body h3 {
          color: white;
          font-size: 1.1rem;
          font-weight: 600;
          margin-top: 1.5rem;
          margin-bottom: 0.5rem;
        }
        .news-article-body img {
          width: 100%;
          height: auto;
          border-radius: 0.75rem;
          margin: 1.5rem 0;
          object-fit: cover;
          max-height: 500px;
        }
        .news-article-body figure {
          margin: 1.5rem 0;
        }
        .news-article-body figcaption {
          color: rgba(255,255,255,0.35);
          font-size: 0.75rem;
          font-family: monospace;
          text-align: center;
          margin-top: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .news-article-body a {
          color: rgba(255,255,255,0.7);
          text-decoration: underline;
          text-underline-offset: 3px;
          transition: color 0.2s;
        }
        .news-article-body a:hover {
          color: white;
        }
        .news-article-body ul, .news-article-body ol {
          color: rgba(255,255,255,0.7);
          padding-left: 1.5rem;
          margin-bottom: 1rem;
          line-height: 1.8;
        }
        .news-article-body li {
          margin-bottom: 0.35rem;
        }
        .news-article-body blockquote {
          border-left: 3px solid rgba(255,255,255,0.15);
          padding-left: 1rem;
          color: rgba(255,255,255,0.5);
          font-style: italic;
          margin: 1.5rem 0;
        }
        .news-article-body strong {
          color: white;
        }
        .news-article-body em {
          color: rgba(255,255,255,0.65);
        }
        .news-article-body hr {
          border-color: rgba(255,255,255,0.08);
          margin: 2rem 0;
        }
        .news-article-body .wp-block-image, .news-article-body .wp-block-embed {
          margin: 1.5rem 0;
        }
        .news-article-body table {
          width: 100%;
          border-collapse: collapse;
          margin: 1.5rem 0;
          font-size: 0.875rem;
          color: rgba(255,255,255,0.7);
        }
        .news-article-body th {
          color: white;
          font-weight: 600;
          border-bottom: 1px solid rgba(255,255,255,0.15);
          padding: 0.5rem 0.75rem;
          text-align: left;
        }
        .news-article-body td {
          padding: 0.5rem 0.75rem;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
      `}</style>
    </div>
  );
}

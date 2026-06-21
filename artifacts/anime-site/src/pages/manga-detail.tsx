import { motion, AnimatePresence } from "framer-motion";
import { Link, useParams } from "wouter";
import { ArrowLeft, Star, BookOpen, X, ExternalLink, ChevronLeft, RefreshCw, Home, Bookmark, BookmarkCheck } from "lucide-react";
import { useMangaList } from "@/hooks/useMangaList";
import { useState, useEffect, useRef } from "react";

const STATUS_LABEL: Record<string, string> = {
  FINISHED:         "Completed",
  RELEASING:        "Ongoing",
  NOT_YET_RELEASED: "Upcoming",
  CANCELLED:        "Cancelled",
  HIATUS:           "On Hiatus",
};

const STATUS_COLOR: Record<string, string> = {
  FINISHED:         "text-blue-400 bg-blue-400/10 border-blue-400/20",
  RELEASING:        "text-green-400 bg-green-400/10 border-green-400/20",
  NOT_YET_RELEASED: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  CANCELLED:        "text-red-400 bg-red-400/10 border-red-400/20",
  HIATUS:           "text-orange-400 bg-orange-400/10 border-orange-400/20",
};

interface AniManga {
  id: number;
  title: { romaji: string; english?: string | null; native?: string | null };
  description?: string | null;
  coverImage: { extraLarge?: string; large?: string };
  bannerImage?: string | null;
  genres: string[];
  averageScore?: number | null;
  status: string;
  startDate?: { year?: number | null; month?: number | null } | null;
  endDate?: { year?: number | null } | null;
  format?: string | null;
  chapters?: number | null;
  volumes?: number | null;
  staff?: { edges: { role: string; node: { name: { full: string } } }[] };
  recommendations?: { nodes: { mediaRecommendation?: { id: number; title: { romaji: string }; coverImage: { large?: string } } | null }[] };
  externalLinks?: { url: string; site: string; type: string }[];
}

const QUERY = `
query ($id: Int!) {
  Media(id: $id, type: MANGA) {
    id
    title { romaji english native }
    description(asHtml: false)
    coverImage { extraLarge large }
    bannerImage
    genres
    averageScore
    status
    startDate { year month }
    endDate { year }
    format
    chapters
    volumes
    staff(perPage: 6) {
      edges { role node { name { full } } }
    }
    recommendations(perPage: 6) {
      nodes { mediaRecommendation { id title { romaji } coverImage { large } } }
    }
    externalLinks { url site type }
  }
}`;

async function fetchMangaDetail(id: number): Promise<AniManga | null> {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { id } }),
  });
  const json = await res.json();
  return json?.data?.Media ?? null;
}

function stripHtml(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+(>|$)/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function ReaderModal({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const searchQuery = encodeURIComponent(title);
  const src = `/api/comix/reader?path=/browse%3Fsearch%3D${searchQuery}`;

  function goHome() {
    if (iframeRef.current) {
      setLoading(true);
      iframeRef.current.src = `/api/comix/reader?path=/browse`;
    }
  }

  function goBack() {
    try { iframeRef.current?.contentWindow?.history.go(-1); } catch { /* cross-origin */ }
  }

  function refresh() {
    if (iframeRef.current) {
      setLoading(true);
      iframeRef.current.src = iframeRef.current.src;
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-[#0a0a0a] flex flex-col"
      style={{ top: 56 }}
    >
      {/* Reader chrome */}
      <div className="flex items-center gap-2.5 px-4 py-2 border-b border-white/[0.06] bg-[#0d0d0d] shrink-0">
        <BookOpen className="w-3.5 h-3.5 text-white/30" />
        <span className="text-[11px] font-mono uppercase tracking-widest text-white/40">Reading</span>
        <span className="text-white/10 text-xs">·</span>
        <span className="text-[10px] font-mono text-white/20 max-w-[200px] truncate">{title}</span>

        {loading && (
          <span className="ml-1 flex items-center gap-1 text-[10px] font-mono text-white/20">
            <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse inline-block" />
            Loading…
          </span>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          <button onClick={goHome} className="p-1.5 rounded hover:bg-white/[0.07] transition-colors text-white/25 hover:text-white/70" title="Search">
            <Home className="w-3.5 h-3.5" />
          </button>
          <button onClick={goBack} className="p-1.5 rounded hover:bg-white/[0.07] transition-colors text-white/25 hover:text-white/70" title="Go back">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button onClick={refresh} className="p-1.5 rounded hover:bg-white/[0.07] transition-colors text-white/25 hover:text-white/70" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <a href={`https://comix.to/browse?search=${searchQuery}`} target="_blank" rel="noopener noreferrer"
            className="p-1.5 rounded hover:bg-white/[0.07] transition-colors text-white/20 hover:text-white/60" title="Open externally">
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <button onClick={onClose} className="p-1.5 rounded hover:bg-white/[0.07] transition-colors text-white/25 hover:text-white/70" title="Close reader (Esc)">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Iframe */}
      <div className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a] z-10 pointer-events-none">
            <div className="flex flex-col items-center gap-3">
              <div className="w-7 h-7 border border-white/20 border-t-white/60 rounded-full animate-spin" />
              <p className="text-[10px] font-mono text-white/20 uppercase tracking-widest">Loading reader…</p>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={src}
          className="w-full h-full border-0"
          title="Manga Reader"
          allow="fullscreen"
          onLoad={() => setLoading(false)}
        />
      </div>
    </motion.div>
  );
}

export default function MangaDetail() {
  const { id } = useParams<{ id: string }>();
  const [manga, setManga] = useState<AniManga | null>(null);
  const [loading, setLoading] = useState(true);
  const { toggle: toggleList, isInList } = useMangaList();
  const [descExpanded, setDescExpanded] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setManga(null);
    fetchMangaDetail(Number(id)).then(data => {
      setManga(data);
      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border border-white/20 border-t-white/60 rounded-full animate-spin" />
          <p className="text-[10px] font-mono text-white/20 uppercase tracking-widest">Loading…</p>
        </div>
      </div>
    );
  }

  if (!manga) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center gap-4">
        <BookOpen className="w-10 h-10 text-white/10" />
        <p className="text-white/25 font-mono text-sm uppercase tracking-widest">Manga not found</p>
        <Link href="/manga" className="text-white/40 hover:text-white/70 text-xs font-mono uppercase tracking-widest border border-white/10 hover:border-white/25 px-3 py-1.5 transition-colors">
          ← Back to Manga
        </Link>
      </div>
    );
  }

  const title = manga.title.english ?? manga.title.romaji;
  const cover = manga.coverImage?.extraLarge ?? manga.coverImage?.large ?? "";
  const score = manga.averageScore ? (manga.averageScore / 10).toFixed(1) : null;
  const status = STATUS_LABEL[manga.status] ?? manga.status;
  const statusColor = STATUS_COLOR[manga.status] ?? "text-white/40 bg-white/5 border-white/10";
  const description = manga.description ? stripHtml(manga.description) : null;
  const truncDesc = description && description.length > 280;
  const displayDesc = truncDesc && !descExpanded ? description.slice(0, 280) + "…" : description;
  const authors = manga.staff?.edges.filter(e => e.role === "Story" || e.role === "Art" || e.role === "Story & Art").map(e => e.node.name.full) ?? [];
  const readLinks = manga.externalLinks?.filter(l => l.type === "STREAMING" || l.site.toLowerCase().includes("manga") || l.site.toLowerCase().includes("viz")) ?? [];

  return (
    <>
      <div className="min-h-screen bg-[#0a0a0a] pb-20">
        {/* Banner */}
        <div className="relative h-48 sm:h-64 overflow-hidden">
          {manga.bannerImage ? (
            <>
              <img src={manga.bannerImage} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0a0a0a]/60 to-[#0a0a0a]" />
            </>
          ) : (
            <div
              className="w-full h-full"
              style={{
                background: `radial-gradient(ellipse at 60% 50%, rgba(255,255,255,0.04) 0%, transparent 70%), #0a0a0a`,
              }}
            />
          )}
          <div className="absolute top-4 left-4">
            <Link href="/manga">
              <button className="flex items-center gap-1.5 px-3 py-1.5 bg-black/60 backdrop-blur-sm border border-white/10 text-white/50 hover:text-white/80 text-xs font-mono uppercase tracking-widest transition-colors">
                <ArrowLeft className="w-3 h-3" /> Manga
              </button>
            </Link>
          </div>
        </div>

        {/* Main content */}
        <div className="max-w-5xl mx-auto px-6 -mt-20 relative">
          <div className="flex flex-col sm:flex-row gap-6">
            {/* Cover */}
            <div className="flex-shrink-0 w-36 sm:w-44">
              <div className="w-full aspect-[2/3] border border-white/10 overflow-hidden shadow-2xl">
                {cover && <img src={cover} alt={title} className="w-full h-full object-cover" />}
              </div>
            </div>

            {/* Info */}
            <div className="flex-1 pt-2 sm:pt-8">
              {manga.title.native && (
                <p className="text-[10px] font-mono text-white/25 uppercase tracking-widest mb-1">{manga.title.native}</p>
              )}
              <h1 className="text-2xl sm:text-3xl font-serif text-white leading-tight mb-2">{title}</h1>
              {manga.title.romaji !== title && (
                <p className="text-sm text-white/35 font-mono mb-3">{manga.title.romaji}</p>
              )}

              {authors.length > 0 && (
                <p className="text-xs text-white/40 font-mono mb-4">by {authors.join(", ")}</p>
              )}

              {/* Badges row */}
              <div className="flex flex-wrap items-center gap-2 mb-5">
                <span className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border ${statusColor}`}>
                  {status}
                </span>
                {manga.format && (
                  <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border border-white/10 text-white/35 bg-white/[0.03]">
                    {manga.format.replace("_", " ")}
                  </span>
                )}
                {score && (
                  <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono border border-white/10 text-white/50 bg-white/[0.03]">
                    <Star className="w-2.5 h-2.5 fill-white/40 text-white/40" />
                    {score}
                  </span>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-px bg-white/[0.05] border border-white/[0.05] mb-5 w-fit">
                {manga.chapters && (
                  <div className="px-4 py-3 bg-[#0a0a0a] text-center min-w-[70px]">
                    <p className="text-white text-base font-serif">{manga.chapters}</p>
                    <p className="text-[9px] font-mono text-white/25 uppercase tracking-widest mt-0.5">Chapters</p>
                  </div>
                )}
                {manga.volumes && (
                  <div className="px-4 py-3 bg-[#0a0a0a] text-center min-w-[70px]">
                    <p className="text-white text-base font-serif">{manga.volumes}</p>
                    <p className="text-[9px] font-mono text-white/25 uppercase tracking-widest mt-0.5">Volumes</p>
                  </div>
                )}
                {manga.startDate?.year && (
                  <div className="px-4 py-3 bg-[#0a0a0a] text-center min-w-[70px]">
                    <p className="text-white text-base font-serif">{manga.startDate.year}</p>
                    <p className="text-[9px] font-mono text-white/25 uppercase tracking-widest mt-0.5">Published</p>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <button
                  onClick={() => setReaderOpen(true)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-white text-black text-sm font-mono uppercase tracking-widest hover:bg-white/90 transition-colors"
                >
                  <BookOpen className="w-4 h-4" />
                  Read Now
                </button>
                <button
                  onClick={() => manga && toggleList(manga.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 border text-sm font-mono uppercase tracking-widest transition-colors ${
                    manga && isInList(manga.id)
                      ? "border-white bg-white text-black"
                      : "border-white/20 text-white/50 hover:border-white/50 hover:text-white/80"
                  }`}
                  title={manga && isInList(manga.id) ? "Remove from My List" : "Save to My List"}
                >
                  {manga && isInList(manga.id)
                    ? <><BookmarkCheck className="w-4 h-4" /> Saved</>
                    : <><Bookmark className="w-4 h-4" /> Save</>
                  }
                </button>
              </div>
              <p className="text-[9px] font-mono text-white/20">Powered by comix.to</p>
            </div>
          </div>

          {/* Genres */}
          {manga.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-6">
              {manga.genres.map(g => (
                <Link key={g} href={`/manga?genre=${encodeURIComponent(g)}`}>
                  <span className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest border border-white/[0.07] text-white/35 hover:border-white/20 hover:text-white/60 transition-colors cursor-pointer">
                    {g}
                  </span>
                </Link>
              ))}
            </div>
          )}

          {/* Description */}
          {displayDesc && (
            <div className="mt-6 border-t border-white/[0.05] pt-6">
              <p className="text-[10px] font-mono text-white/25 uppercase tracking-widest mb-3">Synopsis</p>
              <p className="text-sm text-white/60 leading-relaxed whitespace-pre-line">{displayDesc}</p>
              {truncDesc && (
                <button
                  onClick={() => setDescExpanded(v => !v)}
                  className="mt-2 text-[10px] font-mono text-white/30 hover:text-white/60 uppercase tracking-widest transition-colors"
                >
                  {descExpanded ? "Show less" : "Read more"}
                </button>
              )}
            </div>
          )}

          {/* External links */}
          {readLinks.length > 0 && (
            <div className="mt-6 border-t border-white/[0.05] pt-6">
              <p className="text-[10px] font-mono text-white/25 uppercase tracking-widest mb-3">Official Sources</p>
              <div className="flex flex-wrap gap-2">
                {readLinks.map((link, i) => (
                  <a
                    key={`${link.site}-${i}`}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-white/[0.07] text-white/35 hover:border-white/20 hover:text-white/60 transition-colors"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    {link.site}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {manga.recommendations && manga.recommendations.nodes.length > 0 && (
            <div className="mt-8 border-t border-white/[0.05] pt-6">
              <p className="text-[10px] font-mono text-white/25 uppercase tracking-widest mb-4">You might also like</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {manga.recommendations.nodes
                  .filter(n => n.mediaRecommendation)
                  .map(n => {
                    const rec = n.mediaRecommendation!;
                    return (
                      <Link key={rec.id} href={`/manga/al/${rec.id}`}>
                        <motion.div
                          whileHover={{ y: -2 }}
                          className="group cursor-pointer"
                        >
                          <div className="w-full aspect-[2/3] overflow-hidden border border-white/5 bg-zinc-950 mb-1.5">
                            {rec.coverImage.large && (
                              <img
                                src={rec.coverImage.large}
                                alt={rec.title.romaji}
                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                              />
                            )}
                          </div>
                          <p className="text-[9px] font-mono text-white/35 line-clamp-2 leading-snug group-hover:text-white/60 transition-colors">
                            {rec.title.romaji}
                          </p>
                        </motion.div>
                      </Link>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Reader overlay */}
      <AnimatePresence>
        {readerOpen && (
          <ReaderModal
            title={manga.title.english ?? manga.title.romaji}
            onClose={() => setReaderOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

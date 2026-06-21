import { motion, AnimatePresence } from "framer-motion";
import { Link, useParams } from "wouter";
import { ArrowLeft, Star, BookOpen, X, ExternalLink, ChevronLeft, RefreshCw, ChevronDown, Check, Minus, Plus } from "lucide-react";
import { useMangaList, type ReadStatus } from "@/hooks/useMangaList";
import { useState, useEffect, useRef } from "react";

const READ_STATUSES: { value: ReadStatus; label: string; dot: string }[] = [
  { value: "reading",      label: "Reading",      dot: "bg-green-400" },
  { value: "plan_to_read", label: "Plan to Read", dot: "bg-blue-400" },
  { value: "completed",    label: "Completed",    dot: "bg-purple-400" },
];

const STATUS_PICKER_CONFIG: Record<ReadStatus, { label: string; active: string }> = {
  reading:      { label: "Reading",      active: "border-green-400/50 text-green-400 bg-green-400/10" },
  plan_to_read: { label: "Plan to Read", active: "border-blue-400/50 text-blue-400 bg-blue-400/10" },
  completed:    { label: "Completed",    active: "border-purple-400/50 text-purple-400 bg-purple-400/10" },
};

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

type FindResult =
  | { status: "searching" }
  | { status: "found"; url: string; comixTitle: string }
  | { status: "not_found" };

function ReaderModal({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [findResult, setFindResult] = useState<FindResult>({ status: "searching" });
  const [blankDetected, setBlankDetected] = useState(false);

  /* On mount: find the comix.to title page URL so we load SSR content
     instead of the broken SPA browse/search page. */
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/comix/find?title=${encodeURIComponent(title)}`)
      .then(r => r.json())
      .then((data: { found: boolean; url?: string; title?: string }) => {
        if (cancelled) return;
        if (data.found && data.url) {
          setFindResult({ status: "found", url: data.url, comixTitle: data.title ?? title });
        } else {
          setFindResult({ status: "not_found" });
        }
      })
      .catch(() => {
        if (!cancelled) setFindResult({ status: "not_found" });
      });
    return () => { cancelled = true; };
  }, [title]);

  const searchQuery = encodeURIComponent(title);
  const src =
    findResult.status === "found" && !blankDetected
      ? `/api/comix/reader?path=${encodeURIComponent(findResult.url)}`
      : null;

  function goBack() {
    try { iframeRef.current?.contentWindow?.history.go(-1); } catch { /* cross-origin */ }
  }

  function refresh() {
    if (iframeRef.current && src) {
      setBlankDetected(false);
      setIframeLoading(true);
      iframeRef.current.src = src;
    }
  }

  function handleIframeLoad() {
    setIframeLoading(false);
    // After the iframe loads, wait 3 s for the SPA to hydrate, then check
    // if the app-root is empty (blank white SPA shell). If so, fall back to
    // the "not found" UI so the user sees the external link instead of white.
    const iframe = iframeRef.current;
    if (!iframe) return;
    const timer = setTimeout(() => {
      try {
        const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
        if (!doc) return;
        const appRoot = doc.getElementById("app-root");
        // Blank if app-root exists but has no rendered children
        if (appRoot && appRoot.childElementCount === 0) {
          setBlankDetected(true);
        }
      } catch {
        // Cross-origin guard — shouldn't happen since we proxy through /api
      }
    }, 3000);
    return () => clearTimeout(timer);
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

  const isLoading = findResult.status === "searching" || (findResult.status === "found" && !blankDetected && iframeLoading);
  const showFallback = findResult.status === "not_found" || blankDetected;

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

        {isLoading && (
          <span className="ml-1 flex items-center gap-1 text-[10px] font-mono text-white/20">
            <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse inline-block" />
            {findResult.status === "searching" ? "Searching…" : "Loading…"}
          </span>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          {src && (
            <>
              <button onClick={goBack} className="p-1.5 rounded hover:bg-white/[0.07] transition-colors text-white/25 hover:text-white/70" title="Go back">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button onClick={refresh} className="p-1.5 rounded hover:bg-white/[0.07] transition-colors text-white/25 hover:text-white/70" title="Refresh">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <a href={`https://comix.to/browse?search=${searchQuery}`} target="_blank" rel="noopener noreferrer"
            className="p-1.5 rounded hover:bg-white/[0.07] transition-colors text-white/20 hover:text-white/60" title="Open on comix.to">
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <button onClick={onClose} className="p-1.5 rounded hover:bg-white/[0.07] transition-colors text-white/25 hover:text-white/70" title="Close reader (Esc)">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content area — always dark so there's never a white flash */}
      <div className="flex-1 relative overflow-hidden bg-[#0a0a0a]">
        {/* Spinner overlay — shown while searching or while iframe is loading */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a] z-10 pointer-events-none">
            <div className="flex flex-col items-center gap-3">
              <div className="w-7 h-7 border border-white/20 border-t-white/60 rounded-full animate-spin" />
              <p className="text-[10px] font-mono text-white/20 uppercase tracking-widest">
                {findResult.status === "searching" ? "Finding on comix.to…" : "Loading reader…"}
              </p>
            </div>
          </div>
        )}

        {/* Not-found / blank-page fallback */}
        {showFallback && (
          <div className="absolute inset-0 bg-[#0a0a0a] flex flex-col items-center justify-center gap-6 px-6">
            <div className="flex flex-col items-center gap-3 text-center max-w-sm">
              <BookOpen className="w-10 h-10 text-white/10" />
              <p className="text-white/50 font-serif text-lg leading-snug">{title}</p>
              <p className="text-[11px] font-mono text-white/25 uppercase tracking-widest leading-relaxed">
                {blankDetected
                  ? "The reader couldn't load — open it directly on comix.to."
                  : "This title isn't indexed locally — search for it on comix.to to read chapters."}
              </p>
            </div>
            <div className="flex flex-col items-center gap-2">
              <a
                href={`https://comix.to/browse?search=${searchQuery}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-5 py-2.5 bg-white text-black text-[11px] font-mono uppercase tracking-widest hover:bg-white/90 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Search on comix.to
              </a>
              <p className="text-[10px] font-mono text-white/15 mt-1">Opens in a new tab</p>
            </div>
          </div>
        )}

        {/* Iframe — only mounted when we have a URL and blank not yet detected */}
        {src && (
          <iframe
            ref={iframeRef}
            src={src}
            className="w-full h-full border-0"
            title="Manga Reader"
            allow="fullscreen"
            onLoad={handleIframeLoad}
          />
        )}
      </div>
    </motion.div>
  );
}

export default function MangaDetail() {
  const { id } = useParams<{ id: string }>();
  const [manga, setManga] = useState<AniManga | null>(null);
  const [loading, setLoading] = useState(true);
  const { isInList, getStatus, setStatus, getChapter, setChapter, remove: removeFromList } = useMangaList();
  const [statusOpen, setStatusOpen] = useState(false);
  const [chapterInput, setChapterInput] = useState<string | null>(null);
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

                {/* Status picker */}
                {manga && (
                  <div className="relative">
                    <button
                      onClick={() => setStatusOpen((v) => !v)}
                      className={`flex items-center gap-2 px-4 py-2.5 border text-sm font-mono uppercase tracking-widest transition-colors ${
                        isInList(manga.id)
                          ? STATUS_PICKER_CONFIG[getStatus(manga.id)!].active
                          : "border-white/20 text-white/50 hover:border-white/40 hover:text-white/80"
                      }`}
                    >
                      {isInList(manga.id) ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          {STATUS_PICKER_CONFIG[getStatus(manga.id)!].label}
                        </>
                      ) : "Add to List"}
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${statusOpen ? "rotate-180" : ""}`} />
                    </button>

                    <AnimatePresence>
                      {statusOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 6 }}
                          transition={{ duration: 0.12 }}
                          className="absolute left-0 top-full mt-1 z-30 bg-zinc-900 border border-white/10 shadow-2xl min-w-[160px] overflow-hidden"
                        >
                          {READ_STATUSES.map(({ value, label, dot }) => {
                            const active = isInList(manga.id) && getStatus(manga.id) === value;
                            return (
                              <button
                                key={value}
                                onClick={() => { setStatus(manga.id, value); setStatusOpen(false); }}
                                className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[11px] font-mono uppercase tracking-widest transition-colors ${
                                  active ? "bg-white/[0.08] text-white" : "text-white/50 hover:bg-white/[0.05] hover:text-white/80"
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                                {label}
                                {active && <Check className="w-3 h-3 ml-auto" />}
                              </button>
                            );
                          })}
                          {isInList(manga.id) && (
                            <>
                              <div className="mx-3 border-t border-white/[0.06]" />
                              <button
                                onClick={() => { removeFromList(manga.id); setStatusOpen(false); }}
                                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[11px] font-mono uppercase tracking-widest text-red-400/60 hover:text-red-400 hover:bg-white/[0.04] transition-colors"
                              >
                                Remove from list
                              </button>
                            </>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>

              {/* Chapter tracker — shown when manga is in list */}
              {manga && isInList(manga.id) && (
                <div className="flex items-center gap-2 mt-3 mb-1">
                  <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Chapter</span>
                  <div className="flex items-center border border-white/15 overflow-hidden">
                    <button
                      onClick={() => manga && setChapter(manga.id, getChapter(manga.id) - 1)}
                      className="px-2.5 py-1.5 text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={manga.chapters ?? 99999}
                      value={chapterInput ?? getChapter(manga.id)}
                      onChange={(e) => setChapterInput(e.target.value)}
                      onBlur={() => {
                        if (chapterInput !== null) {
                          const n = parseInt(chapterInput, 10);
                          if (!isNaN(n)) setChapter(manga.id, n);
                          setChapterInput(null);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      className="w-12 bg-transparent text-center text-sm font-mono text-white py-1.5 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      onClick={() => manga && setChapter(manga.id, getChapter(manga.id) + 1)}
                      className="px-2.5 py-1.5 text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  {manga.chapters && (
                    <span className="text-[10px] font-mono text-white/25">
                      / {manga.chapters}
                      {getChapter(manga.id) > 0 && (
                        <span className="ml-1.5 text-white/40">
                          ({Math.round((getChapter(manga.id) / manga.chapters) * 100)}%)
                        </span>
                      )}
                    </span>
                  )}
                </div>
              )}
              {manga && isInList(manga.id) && manga.chapters && getChapter(manga.id) > 0 && (
                <div className="w-full h-0.5 bg-white/[0.06] mt-1 mb-2 max-w-xs">
                  <div
                    className="h-full bg-white/40 transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.round((getChapter(manga.id) / manga.chapters) * 100))}%` }}
                  />
                </div>
              )}

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

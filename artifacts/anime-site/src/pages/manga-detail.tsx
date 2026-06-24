import { motion, AnimatePresence } from "framer-motion";
import { apiUrl } from "@/lib/api";
import { Link, useParams } from "wouter";
import { ArrowLeft, Star, BookOpen, X, ExternalLink, ChevronLeft, ChevronRight, ChevronDown, Check, Minus, Plus, Loader2 } from "lucide-react";
import { useMangaList, type ReadStatus } from "@/hooks/useMangaList";
import { useState, useEffect, useCallback } from "react";

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
  const res = await fetch("/api/anilist", {
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

interface AtsuChapter {
  id: string;
  number: number;
  title: string | null;
  pageCount: number;
  index: number;
}

function ReaderModal({
  title,
  onClose,
}: {
  anilistId: number;
  title: string;
  onClose: () => void;
}) {
  const [mangaId, setMangaId] = useState<string | null>(null);
  const [findStatus, setFindStatus] = useState<"searching" | "found" | "not_found" | "error">("searching");
  const [chapters, setChapters] = useState<AtsuChapter[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<AtsuChapter | null>(null);
  const [chapterMenuOpen, setChapterMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFindStatus("searching");
    setMangaId(null);
    setChapters([]);
    setSelectedChapter(null);

    fetch(apiUrl(`/api/atsu/find?title=${encodeURIComponent(title)}`))
      .then(r => r.json())
      .then((data: { found: boolean; error?: boolean; mangaId?: string; chapters?: AtsuChapter[] }) => {
        if (cancelled) return;
        if (data.found && data.mangaId) {
          setMangaId(data.mangaId);
          const chs = data.chapters ?? [];
          setChapters(chs);
          if (chs.length) setSelectedChapter(chs[0]);
          setFindStatus("found");
        } else if (data.error) {
          setFindStatus("error");
        } else {
          setFindStatus("not_found");
        }
      })
      .catch(() => { if (!cancelled) setFindStatus("error"); });
    return () => { cancelled = true; };
  }, [title]);

  const goNextChapter = useCallback(() => {
    if (!selectedChapter) return;
    const idx = chapters.findIndex(c => c.id === selectedChapter.id);
    if (idx < chapters.length - 1) setSelectedChapter(chapters[idx + 1]);
  }, [selectedChapter, chapters]);

  const goPrevChapter = useCallback(() => {
    if (!selectedChapter) return;
    const idx = chapters.findIndex(c => c.id === selectedChapter.id);
    if (idx > 0) setSelectedChapter(chapters[idx - 1]);
  }, [selectedChapter, chapters]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNextChapter();
      if (e.key === "ArrowLeft") goPrevChapter();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, goNextChapter, goPrevChapter]);

  const currentIdx = selectedChapter ? chapters.findIndex(c => c.id === selectedChapter.id) : -1;
  const chapterLabel = selectedChapter
    ? `Ch. ${selectedChapter.number}${selectedChapter.title ? ` — ${selectedChapter.title}` : ""}`
    : "Select chapter";
  const iframeSrc = mangaId && selectedChapter
    ? `https://atsu.moe/read/${mangaId}/${selectedChapter.id}`
    : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-[#080808] flex flex-col"
      style={{ top: 56 }}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.06] bg-[#0d0d0d] shrink-0">
        <BookOpen className="w-3.5 h-3.5 text-white/25 shrink-0" />
        <span className="text-[10px] font-mono uppercase tracking-widest text-white/30 truncate max-w-[120px] hidden sm:block">{title}</span>

        {/* Chapter nav */}
        <div className="flex items-center gap-1 mx-auto">
          <button
            onClick={goPrevChapter}
            disabled={currentIdx <= 0}
            className="p-1.5 text-white/30 hover:text-white/70 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="relative">
            <button
              onClick={() => setChapterMenuOpen(v => !v)}
              disabled={chapters.length === 0}
              className="flex items-center gap-1.5 px-3 py-1 border border-white/10 text-[11px] font-mono text-white/50 hover:border-white/25 hover:text-white/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed min-w-[130px] justify-between"
            >
              {findStatus === "searching" ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Finding…
                </span>
              ) : (
                <span className="truncate">{chapterLabel}</span>
              )}
              <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${chapterMenuOpen ? "rotate-180" : ""}`} />
            </button>

            <AnimatePresence>
              {chapterMenuOpen && chapters.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.1 }}
                  className="absolute top-full left-0 mt-1 z-50 bg-zinc-900 border border-white/10 shadow-2xl w-56 max-h-72 overflow-y-auto"
                >
                  {chapters.map(ch => (
                    <button
                      key={ch.id}
                      onClick={() => { setSelectedChapter(ch); setChapterMenuOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-[11px] font-mono transition-colors flex items-center justify-between gap-2 ${
                        selectedChapter?.id === ch.id
                          ? "bg-white/10 text-white"
                          : "text-white/45 hover:bg-white/[0.05] hover:text-white/80"
                      }`}
                    >
                      <span className="truncate">Ch. {ch.number}{ch.title ? ` — ${ch.title}` : ""}</span>
                      <span className="text-white/20 shrink-0">{ch.pageCount}p</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={goNextChapter}
            disabled={currentIdx === -1 || currentIdx >= chapters.length - 1}
            className="p-1.5 text-white/30 hover:text-white/70 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {iframeSrc && (
          <a
            href={iframeSrc}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 text-white/25 hover:text-white/70 transition-colors"
            title="Open on atsu.moe"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}

        <button
          onClick={onClose}
          className="p-1.5 text-white/25 hover:text-white/70 transition-colors"
          title="Close (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 relative bg-[#111]">
        {findStatus === "searching" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 text-white/30 animate-spin" />
            <p className="text-[11px] font-mono text-white/25 uppercase tracking-widest">Finding manga…</p>
          </div>
        )}

        {(findStatus === "not_found" || findStatus === "error") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6">
            <BookOpen className="w-10 h-10 text-white/10" />
            <p className="text-white/40 font-serif text-lg text-center">{title}</p>
            {findStatus === "error" ? (
              <>
                <p className="text-[11px] font-mono text-white/20 uppercase tracking-widest">Could not reach atsu.moe</p>
                <a
                  href={`https://atsu.moe/search?q=${encodeURIComponent(title)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 text-[11px] font-mono text-white/40 hover:border-white/30 hover:text-white/70 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  Search on atsu.moe
                </a>
              </>
            ) : (
              <>
                <p className="text-[11px] font-mono text-white/20 uppercase tracking-widest">Not found on atsu.moe</p>
                <a
                  href={`https://atsu.moe/search?q=${encodeURIComponent(title)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 text-[11px] font-mono text-white/40 hover:border-white/30 hover:text-white/70 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  Search on atsu.moe
                </a>
              </>
            )}
          </div>
        )}

        {findStatus === "found" && iframeSrc && (
          <iframe
            key={iframeSrc}
            src={iframeSrc}
            className="w-full h-full border-0"
            allow="fullscreen"
            title={`Reading ${title}`}
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
            anilistId={manga.id}
            title={manga.title.english ?? manga.title.romaji}
            onClose={() => setReaderOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

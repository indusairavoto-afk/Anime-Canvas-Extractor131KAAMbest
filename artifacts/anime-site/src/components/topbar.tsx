import { Link, useLocation } from "wouter";
import { Search, Bell, X, ArrowRight } from "lucide-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface AniResult {
  id: number;
  title: { romaji: string; english?: string | null };
  coverImage: { medium?: string; large?: string };
  format?: string | null;
  seasonYear?: number | null;
  averageScore?: number | null;
  status?: string | null;
}

async function searchAniList(query: string): Promise<AniResult[]> {
  if (!query.trim()) return [];
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `{
        Page(perPage: 8) {
          media(search: "${query.replace(/"/g, "")}", type: ANIME, isAdult: false) {
            id
            title { romaji english }
            coverImage { medium large }
            format
            seasonYear
            averageScore
            status
          }
        }
      }`,
    }),
  });
  const json = await res.json();
  return json?.data?.Page?.media ?? [];
}

export function Topbar() {
  const [modalOpen, setModalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AniResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [scrolled, setScrolled] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, navigate] = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const headerBg = useMemo(() =>
    scrolled
      ? "rgba(0,0,0,0.92)"
      : "linear-gradient(to bottom, rgba(0,0,0,0.72) 0%, transparent 100%)",
  [scrolled]);

  const openModal = useCallback(() => {
    setModalOpen(true);
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
  }, []);

  // Search with debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const res = await searchAniList(query);
      setResults(res);
      setLoading(false);
      setActiveIndex(-1);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Global Ctrl+K / Ctrl+S shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "s")) {
        e.preventDefault();
        if (modalOpen) closeModal(); else openModal();
      }
      if (e.key === "Escape" && modalOpen) closeModal();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [modalOpen, openModal, closeModal]);

  const handleSelect = useCallback((anime: AniResult) => {
    closeModal();
    navigate(`/anime/al/${anime.id}`);
  }, [navigate, closeModal]);

  const handleViewAll = useCallback(() => {
    if (!query.trim()) return;
    closeModal();
    navigate(`/browse?search=${encodeURIComponent(query.trim())}`);
  }, [query, navigate, closeModal]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { closeModal(); return; }
    if (results.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, -1)); }
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && results[activeIndex]) handleSelect(results[activeIndex]);
      else handleViewAll();
    }
  }, [results, activeIndex, closeModal, handleSelect, handleViewAll]);

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center px-3 sm:px-4 gap-3"
        style={{ background: headerBg, transition: "background 0.35s ease" }}
      >
        <Link href="/" className="flex-shrink-0 flex items-center">
          <span className="font-serif text-xl tracking-tight text-white uppercase leading-none">
            N<span className="text-white/40">A</span>
          </span>
        </Link>

        {/* Desktop search trigger */}
        <button
          onClick={openModal}
          className="hidden sm:flex flex-1 max-w-lg items-center gap-3 bg-white/[0.04] border border-white/10 px-4 py-2 hover:border-white/25 transition-colors text-left"
        >
          <Search className="w-4 h-4 text-white/30 flex-shrink-0" />
          <span className="flex-1 text-white/25 text-sm">Search anime...</span>
          <div className="flex items-center gap-1 flex-shrink-0">
            <kbd className="text-[9px] font-mono text-white/20 border border-white/10 px-1 py-0.5">⌘</kbd>
            <kbd className="text-[9px] font-mono text-white/20 border border-white/10 px-1 py-0.5">K</kbd>
          </div>
        </button>

        <div className="ml-auto flex items-center gap-2">
          {/* Mobile search icon */}
          <button onClick={openModal} className="sm:hidden w-9 h-9 flex items-center justify-center text-white/50 hover:text-white transition-colors">
            <Search className="w-5 h-5" />
          </button>
          <button className="relative w-9 h-9 flex items-center justify-center text-white/40 hover:text-white transition-colors">
            <Bell className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-white rounded-full" />
          </button>
          <div className="w-8 h-8 rounded-full bg-white/10 border border-white/20 overflow-hidden">
            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=noir" alt="Profile" className="w-full h-full grayscale" />
          </div>
        </div>
      </header>

      {/* ── Search Modal ── */}
      <AnimatePresence>
        {modalOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm"
              onClick={closeModal}
            />

            {/* Dialog */}
            <motion.div
              key="dialog"
              initial={{ opacity: 0, scale: 0.96, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -16 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="fixed left-1/2 top-[18%] -translate-x-1/2 z-[61] w-full max-w-xl px-4"
            >
              <div className="bg-zinc-900 border border-white/[0.10] shadow-2xl overflow-hidden" style={{ borderRadius: 12 }}>
                {/* Shortcut hint */}
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                  <p className="text-[10px] font-mono text-white/25 uppercase tracking-widest">
                    For quick access:&nbsp;
                    <kbd className="border border-white/15 text-white/30 px-1.5 py-0.5 rounded text-[9px]">CTRL</kbd>
                    &nbsp;+&nbsp;
                    <kbd className="border border-white/15 text-white/30 px-1.5 py-0.5 rounded text-[9px]">K</kbd>
                  </p>
                  <button onClick={closeModal} className="text-white/30 hover:text-white transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-white/[0.08] px-4">
                  <button className="relative py-2 px-3 text-sm font-mono uppercase tracking-widest text-white/80 text-[11px]">
                    Anime
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/70" />
                  </button>
                </div>

                {/* Search input */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
                  <Search className="w-4 h-4 text-white/30 flex-shrink-0" />
                  <input
                    ref={inputRef}
                    type="search"
                    placeholder="Search Anime..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="flex-1 bg-transparent text-white text-sm placeholder:text-white/30 focus:outline-none"
                    autoComplete="off"
                  />
                  {query && (
                    <button onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }} className="text-white/30 hover:text-white/60 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Results */}
                <div className="max-h-72 overflow-y-auto">
                  {loading && (
                    <div className="px-4 py-6 text-center text-white/25 text-xs font-mono uppercase tracking-widest">
                      Searching...
                    </div>
                  )}
                  {!loading && query.length >= 2 && results.length === 0 && (
                    <div className="px-4 py-6 text-center text-white/25 text-xs font-mono uppercase tracking-widest">
                      No results for "{query}"
                    </div>
                  )}
                  {!loading && results.map((anime, i) => {
                    const title = anime.title.english || anime.title.romaji;
                    const cover = anime.coverImage?.medium || anime.coverImage?.large || "";
                    const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
                    return (
                      <button
                        key={anime.id}
                        onClick={() => handleSelect(anime)}
                        onMouseEnter={() => setActiveIndex(i)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left border-b border-white/[0.04] last:border-0 ${i === activeIndex ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"}`}
                      >
                        <img src={cover} alt={title} className="w-9 h-12 object-cover flex-shrink-0 rounded-sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-white text-sm font-medium truncate leading-snug">{title}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {anime.format && <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">{anime.format}</span>}
                            {anime.seasonYear && <span className="text-[9px] font-mono text-white/25">{anime.seasonYear}</span>}
                            {score && <span className="text-[9px] font-mono text-white/30">★ {score}</span>}
                          </div>
                        </div>
                        {i === activeIndex && <ArrowRight className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>

                {/* View all footer */}
                {query.trim() && results.length > 0 && (
                  <button
                    onClick={handleViewAll}
                    className="w-full flex items-center justify-between px-4 py-2.5 border-t border-white/[0.08] text-white/35 hover:text-white hover:bg-white/[0.04] transition-colors text-[10px] font-mono uppercase tracking-widest"
                  >
                    <span>View all results for "{query.trim()}"</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}

                {/* Empty state hint */}
                {!query && (
                  <div className="px-4 py-6 text-center text-white/20 text-[11px] font-mono uppercase tracking-widest">
                    Type to search anime...
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

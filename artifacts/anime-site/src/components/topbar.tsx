import { Link, useLocation } from "wouter";
import { anilistFetch } from "@/lib/api";
import { Search, Bell, X, ArrowRight, LogIn, Home, Flame, Calendar, Trophy, BookOpen, Users, Mic, Bookmark, TrendingUp } from "lucide-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/auth-context";

interface AniResult {
  id: number;
  title: { romaji: string; english?: string | null };
  coverImage: { medium?: string; large?: string };
  format?: string | null;
  seasonYear?: number | null;
  averageScore?: number | null;
  status?: string | null;
}

async function aniListQuery(q: string, perPage = 12): Promise<AniResult[]> {
  try {
    const json = await anilistFetch({
      query: `{
          Page(perPage: ${perPage}) {
            media(search: "${q.replace(/"/g, "")}", type: ANIME, isAdult: false, sort: SEARCH_MATCH) {
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
    });
    return (json as any)?.data?.Page?.media ?? [];
  } catch {
    return [];
  }
}

async function fetchTrending(perPage = 6): Promise<AniResult[]> {
  try {
    const json = await anilistFetch({
      query: `{
          Page(perPage: ${perPage}) {
            media(type: ANIME, isAdult: false, sort: TRENDING_DESC) {
              id
              title { romaji english }
              coverImage { medium large }
              format
              seasonYear
              averageScore
            }
          }
        }`,
    });
    return (json as any)?.data?.Page?.media ?? [];
  } catch {
    return [];
  }
}

function titleScore(anime: AniResult, query: string): number {
  const q = query.toLowerCase();
  const candidates = [
    anime.title.romaji?.toLowerCase() ?? "",
    anime.title.english?.toLowerCase() ?? "",
    (anime.title.romaji ?? "").toLowerCase().replace(/[\s\W_]+/g, ""),
    (anime.title.english ?? "").toLowerCase().replace(/[\s\W_]+/g, ""),
  ];
  let best = 0;
  for (const t of candidates) {
    if (!t) continue;
    if (t === q)              best = Math.max(best, 100);
    else if (t.startsWith(q)) best = Math.max(best, 90);
    else if (t.includes(q))   best = Math.max(best, 75);
    else {
      let ni = 0;
      for (let i = 0; i < t.length && ni < q.length; i++) {
        if (t[i] === q[ni]) ni++;
      }
      if (ni === q.length) best = Math.max(best, 40 + Math.floor(40 * (q.length / t.length)));
    }
  }
  return best;
}

async function searchAniList(query: string): Promise<AniResult[]> {
  const q = query.trim();
  if (!q) return [];
  const shortQ = q.length >= 5 ? q.slice(0, Math.max(3, Math.ceil(q.length * 0.6))) : q;
  const [primary, broad] = await Promise.all([
    aniListQuery(q),
    shortQ !== q ? aniListQuery(shortQ, 16) : Promise.resolve<AniResult[]>([]),
  ]);
  const seen = new Set<number>();
  const merged: AniResult[] = [];
  for (const item of [...primary, ...broad]) {
    if (!seen.has(item.id)) { seen.add(item.id); merged.push(item); }
  }
  return merged
    .map(a => ({ a, s: titleScore(a, q) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, 8)
    .map(({ a }) => a);
}

const QUICK_ACTIONS = [
  { icon: Home,     label: "Home",        hint: "G then H", href: "/" },
  { icon: Flame,    label: "Browse",      hint: "G then B", href: "/browse" },
  { icon: Trophy,   label: "Rankings",    hint: "G then R", href: "/ranking" },
  { icon: Calendar, label: "Schedule",    hint: "G then S", href: "/schedule" },
  { icon: BookOpen, label: "Manga",       hint: "G then M", href: "/manga" },
  { icon: Mic,      label: "Dubbed",      hint: "G then D", href: "/dubbed" },
  { icon: Users,    label: "Community",   hint: "G then C", href: "/community" },
  { icon: Bookmark, label: "My Watchlist",hint: "G then W", href: "/watchlist" },
];

export function Topbar() {
  const [modalOpen, setModalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AniResult[]>([]);
  const [trending, setTrending] = useState<AniResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [scrolled, setScrolled] = useState(false);
  const [trendingLoaded, setTrendingLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<"anime" | "actions">("anime");
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gRef = useRef(false);
  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, navigate] = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const headerBg = useMemo(() =>
    scrolled ? "rgba(0,0,0,0.72)" : "transparent",
  [scrolled]);

  const openModal = useCallback(() => {
    setModalOpen(true);
    setTimeout(() => inputRef.current?.focus(), 80);
    if (!trendingLoaded) {
      fetchTrending().then((t) => { setTrending(t); setTrendingLoaded(true); });
    }
  }, [trendingLoaded]);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
    setActiveTab("anime");
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const res = await searchAniList(query);
      setResults(res);
      setLoading(false);
      setActiveIndex(-1);
    }, 280);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable;

      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "s")) {
        e.preventDefault();
        if (modalOpen) closeModal(); else openModal();
        return;
      }

      if (e.key === "Escape" && modalOpen) { closeModal(); return; }

      if (!isInput && !modalOpen) {
        if (e.key === "/" ) {
          e.preventDefault();
          openModal();
          return;
        }

        if (e.key === "g" || e.key === "G") {
          gRef.current = true;
          if (gTimerRef.current) clearTimeout(gTimerRef.current);
          gTimerRef.current = setTimeout(() => { gRef.current = false; }, 1200);
          return;
        }

        if (gRef.current) {
          gRef.current = false;
          if (gTimerRef.current) clearTimeout(gTimerRef.current);
          const map: Record<string, string> = {
            h: "/", b: "/browse", r: "/ranking",
            s: "/schedule", m: "/manga", d: "/dubbed",
            c: "/community", w: "/watchlist",
          };
          const dest = map[e.key.toLowerCase()];
          if (dest) { e.preventDefault(); navigate(dest); }
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [modalOpen, openModal, closeModal, navigate]);

  const handleSelect = useCallback((anime: AniResult) => {
    closeModal();
    navigate(`/anime/al/${anime.id}`);
  }, [navigate, closeModal]);

  const handleViewAll = useCallback(() => {
    if (!query.trim()) return;
    closeModal();
    navigate(`/browse?search=${encodeURIComponent(query.trim())}`);
  }, [query, navigate, closeModal]);

  const visibleResults = query.length >= 2 ? results : [];
  const showTrending = !query && activeTab === "anime" && trending.length > 0;
  const allItems = activeTab === "actions" ? QUICK_ACTIONS : visibleResults;
  const maxIndex = allItems.length - 1;

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { closeModal(); return; }
    if (e.key === "Tab") {
      e.preventDefault();
      setActiveTab(t => t === "anime" ? "actions" : "anime");
      setActiveIndex(-1);
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, maxIndex)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, -1)); }
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeTab === "actions" && activeIndex >= 0) {
        closeModal();
        navigate(QUICK_ACTIONS[activeIndex].href);
      } else if (activeIndex >= 0 && results[activeIndex]) {
        handleSelect(results[activeIndex]);
      } else {
        handleViewAll();
      }
    }
  }, [results, activeIndex, maxIndex, activeTab, closeModal, handleSelect, handleViewAll, navigate]);

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center px-2 sm:px-4 gap-2"
        style={{ background: headerBg, transition: "background 0.35s ease", backdropFilter: scrolled ? "blur(12px)" : "none" }}
      >
        <Link href="/" className="flex-shrink-0 flex items-center">
          <div className="h-14 overflow-hidden flex-shrink-0" style={{ width: 210 }}>
            <img
              src="/nexa-logo.png"
              alt="Nexa Anime"
              style={{ height: 145, width: "auto", marginTop: -44, marginLeft: -8 }}
            />
          </div>
        </Link>

        <button
          onClick={openModal}
          className="hidden sm:flex flex-1 max-w-lg items-center gap-3 bg-black/40 backdrop-blur-sm rounded-full px-4 py-2 hover:bg-black/55 transition-colors text-left group"
        >
          <Search className="w-4 h-4 text-white/30 flex-shrink-0 group-hover:text-white/50 transition-colors" />
          <span className="flex-1 text-white/25 text-sm group-hover:text-white/40 transition-colors">Search anime…</span>
          <div className="flex items-center gap-1 flex-shrink-0">
            <kbd className="text-[9px] font-mono text-white/20 border border-white/10 px-1 py-0.5 rounded">/</kbd>
          </div>
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={openModal} className="sm:hidden w-9 h-9 flex items-center justify-center text-white/50 hover:text-white transition-colors">
            <Search className="w-5 h-5" />
          </button>
          <button className="relative w-9 h-9 flex items-center justify-center text-white/40 hover:text-white transition-colors">
            <Bell className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-white rounded-full" />
          </button>

          {user ? (
            <Link href={`/u/${user.username}`}>
              <img
                src={user.avatarUrl}
                alt={user.displayName}
                className="w-8 h-8 rounded-full border border-white/20 cursor-pointer hover:border-white/40 transition-colors object-cover bg-zinc-700"
              />
            </Link>
          ) : (
            <Link href="/login">
              <button className="flex items-center gap-1.5 text-xs text-white/80 hover:text-white transition-colors bg-black/40 backdrop-blur-sm hover:bg-black/55 px-4 py-2 rounded-full">
                <LogIn className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign in</span>
              </button>
            </Link>
          )}
        </div>
      </header>

      {/* ── Spotlight Modal ── */}
      <AnimatePresence>
        {modalOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-md"
              onClick={closeModal}
            />
            <motion.div
              key="dialog"
              initial={{ opacity: 0, scale: 0.97, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -20 }}
              transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
              className="fixed left-1/2 top-[14%] -translate-x-1/2 z-[61] w-full max-w-2xl px-4"
            >
              <div
                className="bg-zinc-900/95 border border-white/[0.10] shadow-2xl overflow-hidden"
                style={{ borderRadius: 16 }}
              >
                {/* Input row */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.07]">
                  <Search className="w-5 h-5 text-white/30 flex-shrink-0" />
                  <input
                    ref={inputRef}
                    type="search"
                    placeholder="Search anime or jump to a page…"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setActiveTab("anime"); }}
                    onKeyDown={handleKeyDown}
                    className="flex-1 bg-transparent text-white text-base placeholder:text-white/25 focus:outline-none appearance-none"
                    autoComplete="off"
                  />
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {query ? (
                      <button
                        onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}
                        className="text-white/30 hover:text-white/60 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    ) : (
                      <kbd className="text-[10px] font-mono text-white/20 border border-white/10 px-1.5 py-0.5 rounded">ESC</kbd>
                    )}
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-0 px-4 pt-2 border-b border-white/[0.06]">
                  {(["anime", "actions"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => { setActiveTab(tab); setActiveIndex(-1); inputRef.current?.focus(); }}
                      className={`relative px-3 py-2 text-[11px] font-semibold uppercase tracking-widest transition-colors ${activeTab === tab ? "text-white" : "text-white/30 hover:text-white/55"}`}
                    >
                      {tab === "anime" ? "Anime" : "Go to"}
                      {activeTab === tab && (
                        <motion.span
                          layoutId="tab-underline"
                          className="absolute bottom-0 left-0 right-0 h-[2px] bg-white rounded-full"
                          transition={{ type: "spring", stiffness: 500, damping: 38 }}
                        />
                      )}
                    </button>
                  ))}
                  <span className="ml-auto text-[10px] text-white/18 font-mono pb-2">
                    <kbd className="border border-white/10 px-1 py-0.5 rounded text-white/20">Tab</kbd> to switch
                  </span>
                </div>

                {/* Results area */}
                <div className="max-h-[min(480px,60vh)] overflow-y-auto">

                  {/* ── ANIME tab ── */}
                  {activeTab === "anime" && (
                    <>
                      {loading && (
                        <div className="px-5 py-8 text-center text-white/25 text-xs font-mono uppercase tracking-widest">
                          Searching…
                        </div>
                      )}

                      {!loading && query.length >= 2 && results.length === 0 && (
                        <div className="px-5 py-8 text-center text-white/25 text-xs font-mono uppercase tracking-widest">
                          No results for "{query}"
                        </div>
                      )}

                      {/* Search results */}
                      {!loading && visibleResults.map((anime, i) => {
                        const title = anime.title.english || anime.title.romaji;
                        const cover = anime.coverImage?.medium || anime.coverImage?.large || "";
                        const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
                        return (
                          <button
                            key={anime.id}
                            onClick={() => handleSelect(anime)}
                            onMouseEnter={() => setActiveIndex(i)}
                            className={`w-full flex items-center gap-3 px-5 py-3 transition-colors text-left border-b border-white/[0.04] last:border-0 ${i === activeIndex ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"}`}
                          >
                            <img src={cover} alt={title} className="w-9 h-12 object-cover flex-shrink-0 rounded-md" style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.5)" }} />
                            <div className="min-w-0 flex-1">
                              <p className="text-white text-sm font-medium truncate leading-snug">{title}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                {anime.format && <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">{anime.format}</span>}
                                {anime.seasonYear && <span className="text-[10px] text-white/20">·  {anime.seasonYear}</span>}
                                {score && <span className="text-[10px] text-white/30">★ {score}</span>}
                              </div>
                            </div>
                            {i === activeIndex && <ArrowRight className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />}
                          </button>
                        );
                      })}

                      {/* Trending when idle */}
                      {showTrending && (
                        <>
                          <div className="px-5 pt-4 pb-2 flex items-center gap-2">
                            <TrendingUp className="w-3.5 h-3.5 text-white/25" />
                            <span className="text-[10px] font-mono text-white/25 uppercase tracking-widest">Trending now</span>
                          </div>
                          {trending.map((anime, i) => {
                            const title = anime.title.english || anime.title.romaji;
                            const cover = anime.coverImage?.medium || anime.coverImage?.large || "";
                            const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
                            return (
                              <button
                                key={anime.id}
                                onClick={() => handleSelect(anime)}
                                onMouseEnter={() => setActiveIndex(i)}
                                className={`w-full flex items-center gap-3 px-5 py-2.5 transition-colors text-left border-b border-white/[0.04] last:border-0 ${i === activeIndex ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"}`}
                              >
                                <span className="text-[11px] font-bold text-white/15 w-5 text-right flex-shrink-0">{i + 1}</span>
                                <img src={cover} alt={title} className="w-8 h-10 object-cover flex-shrink-0 rounded" style={{ boxShadow: "0 2px 6px rgba(0,0,0,0.5)" }} />
                                <div className="min-w-0 flex-1">
                                  <p className="text-white/80 text-sm font-medium truncate">{title}</p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    {anime.format && <span className="text-[10px] font-mono text-white/25 uppercase">{anime.format}</span>}
                                    {score && <span className="text-[10px] text-white/25">★ {score}</span>}
                                  </div>
                                </div>
                                {i === activeIndex && <ArrowRight className="w-3.5 h-3.5 text-white/25 flex-shrink-0" />}
                              </button>
                            );
                          })}
                        </>
                      )}

                      {/* Empty idle state */}
                      {!query && !showTrending && (
                        <div className="px-5 py-10 text-center text-white/20 text-[11px] font-mono uppercase tracking-widest">
                          Loading trending…
                        </div>
                      )}
                    </>
                  )}

                  {/* ── ACTIONS tab ── */}
                  {activeTab === "actions" && (
                    <>
                      <div className="px-5 pt-4 pb-2">
                        <span className="text-[10px] font-mono text-white/25 uppercase tracking-widest">Quick navigation</span>
                      </div>
                      {QUICK_ACTIONS.filter(a =>
                        !query || a.label.toLowerCase().includes(query.toLowerCase())
                      ).map((action, i) => {
                        const Icon = action.icon;
                        return (
                          <Link key={action.href} href={action.href} onClick={closeModal}>
                            <div
                              onMouseEnter={() => setActiveIndex(i)}
                              className={`w-full flex items-center gap-3 px-5 py-3 transition-colors border-b border-white/[0.04] last:border-0 cursor-pointer ${i === activeIndex ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"}`}
                            >
                              <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center flex-shrink-0">
                                <Icon className="w-4 h-4 text-white/50" />
                              </div>
                              <span className="flex-1 text-white/75 text-sm font-medium">{action.label}</span>
                              <div className="flex items-center gap-1">
                                <kbd className="text-[9px] font-mono text-white/20 border border-white/10 px-1.5 py-0.5 rounded">{action.hint}</kbd>
                              </div>
                              {i === activeIndex && <ArrowRight className="w-3.5 h-3.5 text-white/30 flex-shrink-0 ml-1" />}
                            </div>
                          </Link>
                        );
                      })}
                    </>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-5 py-2.5 border-t border-white/[0.06] bg-white/[0.02]">
                  {activeTab === "anime" && query.trim() && results.length > 0 ? (
                    <button
                      onClick={handleViewAll}
                      className="flex items-center gap-1.5 text-white/35 hover:text-white transition-colors text-[10px] font-mono uppercase tracking-widest"
                    >
                      <span>See all results for "{query.trim()}"</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  ) : (
                    <span className="text-[10px] text-white/18 font-mono">
                      Press <kbd className="border border-white/10 px-1 py-0.5 rounded text-white/20">/</kbd> anytime to open
                    </span>
                  )}
                  <div className="flex items-center gap-2 text-[10px] text-white/18 font-mono">
                    <span><kbd className="border border-white/10 px-1 py-0.5 rounded text-white/20">↑↓</kbd> navigate</span>
                    <span><kbd className="border border-white/10 px-1 py-0.5 rounded text-white/20">↵</kbd> select</span>
                    <span><kbd className="border border-white/10 px-1 py-0.5 rounded text-white/20">ESC</kbd> close</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

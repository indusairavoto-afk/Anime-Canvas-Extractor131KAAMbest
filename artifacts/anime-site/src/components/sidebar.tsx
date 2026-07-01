import { Link, useLocation } from "wouter";
import { apiUrl } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import { Home, Search, Calendar, Users, Bookmark, Trophy, ChevronRight, ChevronDown, BookOpen, Mic, Newspaper } from "lucide-react";
import { useSidebar } from "@/contexts/sidebar-context";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useState, useEffect, useRef } from "react";

const NAV_ITEMS = [
  { icon: Home, label: "Home", href: "/" },
  { icon: Search, label: "Browse", href: "/browse" },
  { icon: Mic, label: "Dubbed", href: "/dubbed" },
  { icon: Trophy, label: "Rankings", href: "/ranking" },
  { icon: Calendar, label: "Schedule", href: "/schedule" },
  { icon: BookOpen, label: "Manga", href: "/manga" },
  { icon: Newspaper, label: "News", href: "/news" },
  { icon: Users, label: "Community", href: "/community" },
  { icon: Bookmark, label: "My List", href: "/watchlist" },
];

function useAiringCount() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const now = Math.floor(Date.now() / 1000);
    const dayStart = now - (now % 86400);
    const dayEnd = dayStart + 86400;
    fetch(apiUrl("/api/anilist"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `{ Page(perPage: 50) { airingSchedules(airingAt_greater: ${dayStart}, airingAt_lesser: ${dayEnd}, notYetAired: false) { id } } }`,
      }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((d) => {
        const n = d?.data?.Page?.airingSchedules?.length ?? 0;
        setCount(n > 0 ? n : null);
      })
      .catch((e) => { if (e?.name !== "AbortError") {} });
    return () => controller.abort();
  }, []);
  return count;
}

function useScrollDirection(threshold = 60) {
  const [scrolledDown, setScrolledDown] = useState(false);
  const lastY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y < threshold) {
          setScrolledDown(false);
        } else if (y > lastY.current + 8) {
          setScrolledDown(true);
        } else if (y < lastY.current - 8) {
          setScrolledDown(false);
        }
        lastY.current = y;
        ticking.current = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return scrolledDown;
}

const SIDE_ITEMS = [
  { icon: Home,     label: "Home",    href: "/" },
  { icon: Search,   label: "Browse",  href: "/browse" },
  { icon: BookOpen, label: "Manga",   href: "/manga" },
  { icon: Bookmark, label: "My List", href: "/watchlist" },
];

function MobileBottomNav({
  isActive,
  watchlistCount,
}: {
  isActive: (href: string) => boolean;
  watchlistCount: number;
}) {
  const airingCount = useAiringCount();
  const calActive = isActive("/schedule");
  const scrolledDown = useScrollDirection(80);

  return (
    <motion.nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-end"
      animate={{ y: scrolledDown ? 100 : 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 36 }}
      style={{
        background: "rgba(6,6,6,0.96)",
        backdropFilter: "blur(24px)",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {/* Left two tabs */}
      {SIDE_ITEMS.slice(0, 2).map(({ icon: Icon, label, href }) => {
        const active = isActive(href);
        return (
          <Link key={href} href={href} className="flex-1">
            <div className="relative flex flex-col items-center justify-center pt-2 pb-3 gap-1">
              {active && (
                <motion.div
                  layoutId="mobile-active-bg"
                  className="absolute inset-x-3 inset-y-0.5 rounded-xl bg-white/[0.07]"
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                />
              )}
              <Icon
                className={`w-[22px] h-[22px] z-10 transition-colors ${active ? "text-white" : "text-white/28"}`}
                strokeWidth={active ? 2.1 : 1.5}
              />
              <span className={`text-[9px] font-semibold uppercase tracking-widest z-10 transition-colors leading-none ${active ? "text-white" : "text-white/28"}`}>
                {label}
              </span>
            </div>
          </Link>
        );
      })}

      {/* ── Centre Calendar FAB ── */}
      <div className="flex-1 flex justify-center" style={{ marginBottom: 6 }}>
        <Link href="/schedule">
          <div className="relative flex flex-col items-center" style={{ marginTop: -18 }}>
            <motion.div
              whileTap={{ scale: 0.88 }}
              transition={{ type: "spring", stiffness: 500, damping: 28 }}
              className={`relative w-14 h-14 rounded-full flex items-center justify-center shadow-xl border ${
                calActive
                  ? "bg-white border-white/30"
                  : "bg-zinc-800 border-white/12"
              }`}
              style={calActive ? {} : { boxShadow: "0 4px 20px rgba(0,0,0,0.6)" }}
            >
              <Calendar
                className={`w-6 h-6 ${calActive ? "text-black" : "text-white/80"}`}
                strokeWidth={calActive ? 2.2 : 1.7}
              />
              {airingCount !== null && (
                <motion.span
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-orange-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none border border-black/40"
                >
                  {airingCount > 99 ? "99+" : airingCount}
                </motion.span>
              )}
            </motion.div>
            <span className={`text-[9px] font-semibold uppercase tracking-widest mt-1.5 leading-none ${calActive ? "text-white" : "text-white/35"}`}>
              Calendar
            </span>
          </div>
        </Link>
      </div>

      {/* Right two tabs */}
      {SIDE_ITEMS.slice(2).map(({ icon: Icon, label, href }) => {
        const active = isActive(href);
        const showBadge = href === "/watchlist" && watchlistCount > 0;
        return (
          <Link key={href} href={href} className="flex-1">
            <div className="relative flex flex-col items-center justify-center pt-2 pb-3 gap-1">
              {active && (
                <motion.div
                  layoutId="mobile-active-bg"
                  className="absolute inset-x-3 inset-y-0.5 rounded-xl bg-white/[0.07]"
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                />
              )}
              <div className="relative z-10">
                <Icon
                  className={`w-[22px] h-[22px] transition-colors ${active ? "text-white" : "text-white/28"}`}
                  strokeWidth={active ? 2.1 : 1.5}
                />
                {showBadge && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-0.5 bg-white text-black text-[7px] font-bold rounded-full flex items-center justify-center leading-none">
                    {watchlistCount > 9 ? "9+" : watchlistCount}
                  </span>
                )}
              </div>
              <span className={`text-[9px] font-semibold uppercase tracking-widest z-10 transition-colors leading-none ${active ? "text-white" : "text-white/28"}`}>
                {label}
              </span>
            </div>
          </Link>
        );
      })}
    </motion.nav>
  );
}

export function Sidebar() {
  const [location] = useLocation();
  const { hidden, show, hide } = useSidebar();
  const { ids } = useWatchlist();
  const scrolledDown = useScrollDirection(80);
  const [manuallyHidden, setManuallyHidden] = useState(false);

  const isActive = (href: string) =>
    location === href || (href !== "/" && location.startsWith(href));

  const isVisible = !manuallyHidden && !scrolledDown;

  return (
    <>
      <div className="hidden md:block">
        <AnimatePresence>
          {/* ── Floating pill ── */}
          {isVisible && (
            <motion.aside
              key="float"
              initial={{ x: -180, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -180, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
              className="fixed left-3 top-1/2 -translate-y-1/2 z-40 flex flex-col bg-zinc-900/90 backdrop-blur-xl border border-white/[0.08] shadow-2xl overflow-hidden"
              style={{ borderRadius: 26, width: 52 }}
            >
              {/* Active stripe */}
              <div className="absolute left-0 top-0 bottom-0 w-[2px] pointer-events-none">
                {NAV_ITEMS.map(({ href }, i) =>
                  isActive(href) ? (
                    <motion.div
                      key={href}
                      layoutId="active-stripe"
                      className="bg-white"
                      style={{
                        position: "absolute",
                        top: `${(i / NAV_ITEMS.length) * 100 + (1 / NAV_ITEMS.length) * 100 * 0.2}%`,
                        height: `${(1 / NAV_ITEMS.length) * 100 * 0.6}%`,
                        width: 2,
                        borderRadius: 2,
                      }}
                    />
                  ) : null
                )}
              </div>

              <nav className="flex flex-col py-3 flex-1">
                {NAV_ITEMS.map(({ icon: Icon, label, href }) => {
                  const active = isActive(href);
                  const showBadge = href === "/watchlist" && ids.length > 0;
                  const showCommunityBadge = href === "/community";
                  return (
                    <Link key={href} href={href}>
                      <motion.div
                        whileHover={{ backgroundColor: "rgba(255,255,255,0.06)" }}
                        whileTap={{ scale: 0.92 }}
                        className={`relative flex items-center justify-center cursor-pointer mx-1.5 my-0.5 ${active ? "bg-white/[0.08]" : ""}`}
                        style={{ borderRadius: 16, padding: "10px 12px" }}
                        title={label}
                      >
                        <div className="relative flex-shrink-0">
                          <Icon className={`w-5 h-5 ${active ? "text-white" : "text-white/40"}`} strokeWidth={active ? 2 : 1.5} />
                          {showBadge && (
                            <motion.span
                              key={ids.length}
                              initial={{ scale: 0.6, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              className="absolute -top-1.5 -right-1.5 bg-white text-black text-[8px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none"
                            >
                              {ids.length > 99 ? "99" : ids.length}
                            </motion.span>
                          )}
                          {showCommunityBadge && (
                            <span className="absolute -top-1.5 -right-1.5 bg-white/80 text-black text-[8px] font-bold w-2 h-2 rounded-full" />
                          )}
                        </div>
                      </motion.div>
                    </Link>
                  );
                })}
              </nav>

              <div className="mx-3 border-t border-white/[0.08]" />
              <button
                onClick={() => setManuallyHidden(true)}
                className="flex items-center justify-center py-3 text-white/25 hover:text-white/60 transition-colors"
                title="Hide sidebar"
              >
                <ChevronDown className="w-3.5 h-3.5 rotate-90" />
              </button>
            </motion.aside>
          )}

        </AnimatePresence>
      </div>

      {/* ── MOBILE: smart bottom tab bar ── */}
      <MobileBottomNav isActive={isActive} watchlistCount={ids.length} />
    </>
  );
}

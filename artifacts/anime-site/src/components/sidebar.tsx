import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Home, Search, Calendar, Users, Bookmark, Trophy, ChevronRight, ChevronDown, BookOpen } from "lucide-react";
import { useSidebar } from "@/contexts/sidebar-context";
import { useWatchlist } from "@/hooks/useWatchlist";

const NAV_ITEMS = [
  { icon: Home, label: "Home", href: "/" },
  { icon: Search, label: "Browse", href: "/browse" },
  { icon: Trophy, label: "Rankings", href: "/ranking" },
  { icon: Calendar, label: "Schedule", href: "/schedule" },
  { icon: BookOpen, label: "Manga", href: "/manga" },
  { icon: Users, label: "Community", href: "/community" },
  { icon: Bookmark, label: "My List", href: "/watchlist" },
];

export function Sidebar() {
  const [location] = useLocation();
  const { hidden, show, hide } = useSidebar();
  const { ids } = useWatchlist();

  const isActive = (href: string) =>
    location === href || (href !== "/" && location.startsWith(href));

  return (
    <>
      <div className="hidden md:block">
        <AnimatePresence>
          {/* ── Floating pill ── */}
          {!hidden && (
            <motion.aside
              key="float"
              initial={{ x: -180, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -180, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
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
                            <span className="absolute -top-1.5 -right-1.5 bg-white text-black text-[8px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none">54</span>
                          )}
                        </div>
                      </motion.div>
                    </Link>
                  );
                })}
              </nav>

              <div className="mx-3 border-t border-white/[0.08]" />
              <button
                onClick={hide}
                className="flex items-center justify-center py-3 text-white/25 hover:text-white/60 transition-colors"
                title="Hide sidebar"
              >
                <ChevronDown className="w-3.5 h-3.5 rotate-90" />
              </button>
            </motion.aside>
          )}

          {/* ── Show tab when hidden ── */}
          {hidden && (
            <motion.button
              key="show-tab"
              initial={{ x: -24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -24, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              onClick={show}
              className="fixed left-0 top-1/2 -translate-y-1/2 z-40 flex items-center justify-center bg-zinc-900/90 backdrop-blur-xl border border-white/[0.08] border-l-0 text-white/30 hover:text-white/70 transition-colors shadow-xl"
              style={{ width: 20, height: 56, borderRadius: "0 10px 10px 0" }}
              title="Show sidebar"
            >
              <ChevronRight className="w-3 h-3" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* ── MOBILE: bottom tab bar ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-black/95 backdrop-blur-xl border-t border-white/[0.08] flex items-stretch">
        {NAV_ITEMS.map(({ icon: Icon, label, href }) => {
          const active = isActive(href);
          const showBadge = href === "/watchlist" && ids.length > 0;
          const showCommunityBadge = href === "/community";
          return (
            <Link key={href} href={href} className="flex-1">
              <div className={`relative flex flex-col items-center justify-center gap-1 py-2.5 transition-all ${active ? "text-white" : "text-white/35"}`}>
                <div className="relative">
                  <Icon className="w-5 h-5" strokeWidth={active ? 2 : 1.5} />
                  {showBadge && (
                    <span className="absolute -top-1.5 -right-1.5 bg-white text-black text-[7px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center leading-none">
                      {ids.length > 9 ? "9+" : ids.length}
                    </span>
                  )}
                  {showCommunityBadge && (
                    <span className="absolute -top-1.5 -right-1.5 bg-white text-black text-[7px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center leading-none">54</span>
                  )}
                </div>
                <span className="text-[9px] font-mono uppercase tracking-widest leading-none">{label}</span>
                {active && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-white" />}
              </div>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

import { useRef, useState } from "react";
import { BookOpen, ChevronLeft, Home, RefreshCw, ExternalLink } from "lucide-react";

const COMIX_ORIGIN = "https://comix.to";
const DEFAULT_PATH = "/browse";

export default function MangaPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState(DEFAULT_PATH);

  const src = `${COMIX_ORIGIN}${currentPath}`;

  function goHome() {
    setCurrentPath(DEFAULT_PATH);
    setLoading(true);
    const el = iframeRef.current;
    if (el) el.src = `${COMIX_ORIGIN}${DEFAULT_PATH}`;
  }

  function goBack() {
    try {
      iframeRef.current?.contentWindow?.history.go(-1);
    } catch {
      /* cross-origin — can't navigate back */
    }
  }

  function refresh() {
    const el = iframeRef.current;
    if (el) {
      setLoading(true);
      el.src = el.src;
    }
  }

  return (
    <div className="flex flex-col bg-[#0f0f0f]" style={{ height: "calc(100vh - 56px)" }}>
      {/* ── Chrome bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-4 py-2 border-b border-white/[0.06] bg-[#0d0d0d] shrink-0">
        <BookOpen className="w-3.5 h-3.5 text-white/35" />
        <span className="text-[11px] font-mono uppercase tracking-widest text-white/45">Manga</span>
        <span className="text-white/10 text-xs">·</span>
        <span className="text-[10px] font-mono text-white/20">comix.to</span>

        {loading && (
          <span className="ml-1 flex items-center gap-1 text-[10px] font-mono text-white/25">
            <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse inline-block" />
            Loading…
          </span>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={goHome}
            className="p-1.5 rounded hover:bg-white/[0.07] transition-colors text-white/25 hover:text-white/70"
            title="Browse manga"
          >
            <Home className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={goBack}
            className="p-1.5 rounded hover:bg-white/[0.07] transition-colors text-white/25 hover:text-white/70"
            title="Go back"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={refresh}
            className="p-1.5 rounded hover:bg-white/[0.07] transition-colors text-white/25 hover:text-white/70"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded hover:bg-white/[0.07] transition-colors text-white/20 hover:text-white/60"
            title="Open comix.to directly"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* ── Manga reader iframe ───────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0f0f0f] z-10 pointer-events-none">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border border-white/20 border-t-white rounded-full animate-spin" />
              <p className="text-[11px] font-mono text-white/25 uppercase tracking-widest">Loading manga reader…</p>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={src}
          className="w-full h-full border-0"
          title="Manga Reader — comix.to"
          allow="fullscreen"
          onLoad={() => setLoading(false)}
        />
      </div>
    </div>
  );
}

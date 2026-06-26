import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Loader2 } from "lucide-react";

interface GifResult {
  id: string;
  url: string;
  preview: string;
  title: string;
}

interface Props {
  onSelect: (url: string) => void;
  onClose: () => void;
}

const TENOR_KEY = "LIVDSRZULELA";
const TENOR_BASE = "https://api.tenor.com/v1";

export default function GifPicker({ onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [trending, setTrending] = useState<GifResult[]>([]);
  const [trendingLoaded, setTrendingLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toGifResult = (item: any): GifResult => {
    const gif = item.media?.[0]?.gif;
    const tinygif = item.media?.[0]?.tinygif;
    return {
      id: item.id,
      url: gif?.url ?? "",
      preview: tinygif?.url ?? gif?.url ?? "",
      title: item.title ?? "",
    };
  };

  const loadTrending = useCallback(async () => {
    if (trendingLoaded) return;
    setLoading(true);
    try {
      const r = await fetch(`${TENOR_BASE}/trending?key=${TENOR_KEY}&limit=24&media_filter=minimal`);
      const data = await r.json();
      setTrending((data.results ?? []).map(toGifResult));
      setTrendingLoaded(true);
    } catch {}
    setLoading(false);
  }, [trendingLoaded]);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const r = await fetch(`${TENOR_BASE}/search?q=${encodeURIComponent(q)}&key=${TENOR_KEY}&limit=24&media_filter=minimal`);
      const data = await r.json();
      setResults((data.results ?? []).map(toGifResult));
    } catch {}
    setLoading(false);
  }, []);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 400);
  };

  const displayed = query.trim() ? results : trending;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 8 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-950 border border-white/10 w-full max-w-lg flex flex-col"
        style={{ maxHeight: "80vh" }}
        onAnimationComplete={() => loadTrending()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-white/8">
          <Search className="w-4 h-4 text-white/30 shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search GIFs…"
            className="flex-1 bg-transparent text-white text-sm placeholder:text-white/25 focus:outline-none"
          />
          {loading && <Loader2 className="w-3.5 h-3.5 text-white/30 animate-spin shrink-0" />}
          <button onClick={onClose} className="text-white/30 hover:text-white transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!query.trim() && !trendingLoaded && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-white/20 animate-spin" />
          </div>
        )}

        {/* Grid */}
        <div className="overflow-y-auto p-3 grid grid-cols-3 gap-2 flex-1">
          {displayed.map((gif) => (
            <button
              key={gif.id}
              onClick={() => { onSelect(gif.url); onClose(); }}
              className="relative aspect-video overflow-hidden border border-white/5 hover:border-white/30 transition-colors group"
              title={gif.title}
            >
              <img
                src={gif.preview}
                alt={gif.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                loading="lazy"
              />
            </button>
          ))}
          {displayed.length === 0 && query.trim() && !loading && (
            <div className="col-span-3 py-10 text-center text-white/25 text-sm font-mono">
              No results for "{query}"
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-white/5 text-[9px] font-mono text-white/15 text-right">
          Powered by Tenor
        </div>
      </motion.div>
    </motion.div>
  );
}

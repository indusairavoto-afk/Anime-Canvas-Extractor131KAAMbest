import { useEffect, useRef, useState, useCallback } from "react";
import { apiUrl } from "@/lib/api";
import Hls, { type Level } from "hls.js";
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipForward, SkipBack, Settings, Subtitles, Loader2,
  AlertTriangle, RotateCcw, Languages, Download,
} from "lucide-react";

const TRANSLATE_LANGS = [
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "pt", name: "Portuguese" },
  { code: "it", name: "Italian" },
  { code: "ru", name: "Russian" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "id", name: "Indonesian" },
  { code: "tr", name: "Turkish" },
  { code: "ko", name: "Korean" },
  { code: "zh-TW", name: "Chinese (Traditional)" },
  { code: "zh-CN", name: "Chinese (Simplified)" },
  { code: "ja", name: "Japanese" },
  { code: "th", name: "Thai" },
  { code: "vi", name: "Vietnamese" },
  { code: "pl", name: "Polish" },
  { code: "nl", name: "Dutch" },
  { code: "sv", name: "Swedish" },
  { code: "uk", name: "Ukrainian" },
];

interface SubTrack {
  src: string;
  label: string;
  srclang: string;
  isDefault: boolean;
}

export type HlsSyncCommand = {
  type: "play" | "pause" | "seek";
  time: number;
  nonce: string;
};

interface Props {
  hlsUrl: string;
  subtitles?: SubTrack[];
  title?: string;
  progressKey?: string;
  onEnded?: () => void;
  onFatalError?: () => void;
  onPlayStateChange?: (playing: boolean, time: number) => void;
  syncCommand?: HlsSyncCommand | null;
}

interface SavedProgress {
  position: number;
  duration: number;
  ts: number;
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function loadProgress(key: string): SavedProgress | null {
  try {
    const raw = localStorage.getItem(`watch_progress_${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as SavedProgress;
  } catch { return null; }
}

function saveProgress(key: string, position: number, duration: number) {
  try {
    if (position < 5 || duration <= 0) return;
    const data: SavedProgress = { position, duration, ts: Date.now() };
    localStorage.setItem(`watch_progress_${key}`, JSON.stringify(data));
  } catch { /* ignore */ }
}

function clearProgress(key: string) {
  try { localStorage.removeItem(`watch_progress_${key}`); } catch { /* ignore */ }
}

export function getEpisodeProgressPct(progressKey: string): number | null {
  const p = loadProgress(progressKey);
  if (!p || p.duration <= 0) return null;
  const pct = p.position / p.duration;
  if (pct < 0.02 || pct > 0.97) return null;
  return pct;
}

export default function HlsPlayer({ hlsUrl, subtitles = [], title, progressKey, onEnded, onFatalError, onPlayStateChange, syncCommand }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedAt = useRef<number>(0);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<Level[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [showSettings, setShowSettings] = useState(false);
  const [showSubs, setShowSubs] = useState(false);
  const [activeSub, setActiveSub] = useState<string | null>(
    subtitles.find((s) => s.isDefault)?.src ?? (subtitles.length === 1 ? subtitles[0].src : null)
  );
  const [resumeToast, setResumeToast] = useState<string | null>(null);
  const [translateLang, setTranslateLang] = useState("es");
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [currentTranslatedVtt, setCurrentTranslatedVtt] = useState<string | null>(null);
  const translatedCacheRef = useRef<Map<string, string>>(new Map());
  const translatedTextCacheRef = useRef<Map<string, string>>(new Map());
  const blobUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const translateSubtitles = useCallback(async (lang: string, langName: string) => {
    const sourceSrc = activeSub ?? subtitles[0]?.src;
    if (!sourceSrc) return;
    const cacheKey = `${sourceSrc}::${lang}`;
    const cached = translatedCacheRef.current.get(cacheKey);
    if (cached) { setActiveSub(cached); return; }
    setTranslating(true);
    setTranslateError(null);
    try {
      const resp = await fetch(apiUrl("/api/translate-subtitle"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vttUrl: sourceSrc, targetLang: lang, targetLangName: langName }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` })) as { error?: string };
        throw new Error(err.error ?? `HTTP ${resp.status}`);
      }
      const { vtt } = await resp.json() as { vtt: string };
      const blob = new Blob([vtt], { type: "text/vtt" });
      const blobUrl = URL.createObjectURL(blob);
      blobUrlsRef.current.push(blobUrl);
      translatedCacheRef.current.set(cacheKey, blobUrl);
      translatedTextCacheRef.current.set(cacheKey, vtt);
      setCurrentTranslatedVtt(vtt);
      setActiveSub(blobUrl);
    } catch (e) {
      setTranslateError(e instanceof Error ? e.message : "Translation failed");
      setTimeout(() => setTranslateError(null), 5000);
    } finally {
      setTranslating(false);
    }
  }, [activeSub, subtitles]);

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!document.fullscreenElement && !containerRef.current?.matches(":hover")) return;
      setShowControls(false);
    }, 3000);
  }, []);

  const flushProgress = useCallback(() => {
    const video = videoRef.current;
    if (!progressKey || !video || video.currentTime < 5 || video.duration <= 0) return;
    const pct = video.currentTime / video.duration;
    if (pct > 0.97) {
      clearProgress(progressKey);
    } else {
      saveProgress(progressKey, video.currentTime, video.duration);
    }
    lastSavedAt.current = Date.now();
  }, [progressKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;

    setError(null);
    setLoading(true);
    setLevels([]);
    setCurrentLevel(-1);
    setResumeToast(null);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false, startLevel: -1, maxBufferLength: 30 });
      hlsRef.current = hls;
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        setLevels(data.levels);
        setLoading(false);

        if (progressKey) {
          const saved = loadProgress(progressKey);
          const vidDuration = video.duration || data.levels[0]?.details?.totalduration;
          if (saved && saved.position > 5) {
            const effectiveDuration = vidDuration || saved.duration;
            const pct = saved.position / (effectiveDuration || saved.duration);
            if (pct < 0.95) {
              video.currentTime = saved.position;
              const remaining = saved.duration > 0
                ? `${fmtTime(saved.duration - saved.position)} remaining`
                : "";
              setResumeToast(`Resumed from ${fmtTime(saved.position)}${remaining ? " · " + remaining : ""}`);
              setTimeout(() => setResumeToast(null), 4000);
            }
          }
        }

        video.play().catch(() => {});
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        setCurrentLevel(data.level);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setError(data.details ?? "Stream error");
          setLoading(false);
          onFatalError?.();
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
      video.addEventListener("loadedmetadata", () => {
        setLoading(false);
        if (progressKey) {
          const saved = loadProgress(progressKey);
          if (saved && saved.position > 5 && video.duration > 0 && saved.position / video.duration < 0.95) {
            video.currentTime = saved.position;
            setResumeToast(`Resumed from ${fmtTime(saved.position)}`);
            setTimeout(() => setResumeToast(null), 4000);
          }
        }
      }, { once: true });
    } else {
      setError("Your browser does not support HLS playback.");
      setLoading(false);
    }

    return () => {
      flushProgress();
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [hlsUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => { setPlaying(true); onPlayStateChange?.(true, video.currentTime); };
    const onPause = () => { setPlaying(false); flushProgress(); onPlayStateChange?.(false, video.currentTime); };
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
      if (progressKey && Date.now() - lastSavedAt.current > 5000) {
        flushProgress();
      }
    };
    const onDuration = () => setDuration(video.duration);
    const onWaiting = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    const onEnded_ = () => {
      setPlaying(false);
      if (progressKey) clearProgress(progressKey);
      onEnded?.();
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDuration);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("ended", onEnded_);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDuration);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("ended", onEnded_);
    };
  }, [onEnded, progressKey, flushProgress]);

  // ── External sync command (Watch Together) ───────────────────────────────
  useEffect(() => {
    if (!syncCommand) return;
    const video = videoRef.current;
    if (!video) return;
    const { type, time } = syncCommand;
    if (type === "seek" || type === "play" || type === "pause") {
      video.currentTime = time;
    }
    if (type === "play") {
      video.play().catch(() => {});
    } else if (type === "pause") {
      video.pause();
    }
  }, [syncCommand]);

  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const video = videoRef.current;
      if (!video) return;
      if (e.code === "Space") { e.preventDefault(); video.paused ? video.play() : video.pause(); }
      if (e.code === "ArrowRight") { e.preventDefault(); video.currentTime = Math.min(video.currentTime + 10, video.duration); }
      if (e.code === "ArrowLeft") { e.preventDefault(); video.currentTime = Math.max(video.currentTime - 10, 0); }
      if (e.code === "KeyM") { video.muted = !video.muted; setMuted(video.muted); }
      if (e.code === "KeyF") toggleFullscreen();
      resetHideTimer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resetHideTimer]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleUnload = () => flushProgress();
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [flushProgress]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    video.paused ? video.play() : video.pause();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  };

  const handleVolume = (v: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = v;
    video.muted = v === 0;
    setVolume(v);
    setMuted(v === 0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Number(e.target.value);
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  };

  const skip = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.currentTime + delta, video.duration));
    resetHideTimer();
  };

  const setQuality = (level: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = level;
      setCurrentLevel(level);
    }
    setShowSettings(false);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  const qualityLabel = (l: Level) =>
    l.height ? `${l.height}p` : l.bitrate ? `${Math.round(l.bitrate / 1000)}k` : "?";

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black select-none"
      onMouseMove={resetHideTimer}
      onMouseEnter={resetHideTimer}
      onMouseLeave={() => { if (hideTimer.current) clearTimeout(hideTimer.current); setShowControls(true); }}
      onDoubleClick={toggleFullscreen}
    >
      <video
        ref={videoRef}
        className="w-full h-full"
        playsInline
        crossOrigin="anonymous"
      >
        {activeSub && (
          <track src={activeSub} kind="subtitles" label="Subtitles" srcLang="en" default />
        )}
      </video>

      {/* Buffering / Loading spinner */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <Loader2 className="w-10 h-10 text-white/70 animate-spin" />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20 bg-black/80">
          <AlertTriangle className="w-10 h-10 text-red-400" />
          <p className="text-white/70 text-sm font-mono text-center max-w-xs">{error}</p>
          <button
            onClick={() => { setError(null); setLoading(true); hlsRef.current?.loadSource(hlsUrl); }}
            className="text-[11px] font-mono px-4 py-1.5 border border-white/20 text-white/60 hover:border-white hover:text-white transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Click-to-play overlay (center) */}
      {!loading && !error && !playing && (
        <div
          className="absolute inset-0 flex items-center justify-center z-10 cursor-pointer"
          onClick={togglePlay}
        >
          <div className="w-16 h-16 rounded-full bg-black/60 border border-white/20 flex items-center justify-center backdrop-blur-sm">
            <Play className="w-7 h-7 text-white fill-white ml-1" />
          </div>
        </div>
      )}

      {/* Resume toast */}
      {resumeToast && (
        <div
          className="absolute top-14 left-1/2 -translate-x-1/2 z-40 pointer-events-none"
          style={{ animation: "fadeInOut 4s ease forwards" }}
        >
          <div className="flex items-center gap-2 bg-black/80 border border-white/15 backdrop-blur-sm px-3 py-1.5 rounded-full">
            <RotateCcw className="w-3 h-3 text-blue-400 shrink-0" />
            <span className="text-white/80 text-[11px] font-mono">{resumeToast}</span>
          </div>
        </div>
      )}

      {/* Controls overlay */}
      <div
        className="absolute inset-0 flex flex-col justify-end z-30 pointer-events-none"
        style={{ opacity: showControls || !playing ? 1 : 0, transition: "opacity 0.25s ease" }}
      >
        {/* Title bar */}
        {title && (
          <div className="absolute top-0 left-0 right-0 px-4 pt-4 pb-8 pointer-events-none"
            style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)" }}
          >
            <p className="text-white text-sm font-semibold truncate drop-shadow">{title}</p>
          </div>
        )}

        {/* Bottom gradient + controls */}
        <div
          className="pointer-events-auto"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)" }}
        >
          {/* Seek bar */}
          <div className="px-4 pt-3 pb-1 group relative">
            <div className="relative h-1 group-hover:h-1.5 transition-all duration-150 rounded-full bg-white/20">
              {/* Buffered */}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/25"
                style={{ width: `${bufferedPct}%` }}
              />
              {/* Played */}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-blue-400"
                style={{ width: `${progress}%` }}
              />
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onChange={handleSeek}
                className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
              />
              {/* Thumb */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-blue-400 opacity-0 group-hover:opacity-100 transition-opacity shadow"
                style={{ left: `calc(${progress}% - 6px)` }}
              />
            </div>
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-1 px-3 pb-3">
            {/* Skip back */}
            <button
              onClick={() => skip(-10)}
              className="p-1.5 text-white/70 hover:text-white transition-colors"
              title="Back 10s (←)"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            {/* Play / Pause */}
            <button
              onClick={togglePlay}
              className="p-1.5 text-white hover:text-white/80 transition-colors"
              title={playing ? "Pause (Space)" : "Play (Space)"}
            >
              {playing
                ? <Pause className="w-5 h-5 fill-current" />
                : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>

            {/* Skip forward */}
            <button
              onClick={() => skip(10)}
              className="p-1.5 text-white/70 hover:text-white transition-colors"
              title="Forward 10s (→)"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            {/* Volume */}
            <div className="flex items-center gap-1.5 group/vol">
              <button onClick={toggleMute} className="p-1.5 text-white/70 hover:text-white transition-colors" title="Mute (M)">
                {muted || volume === 0
                  ? <VolumeX className="w-4 h-4" />
                  : <Volume2 className="w-4 h-4" />}
              </button>
              <div className="w-0 group-hover/vol:w-16 overflow-hidden transition-all duration-200">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => handleVolume(Number(e.target.value))}
                  className="w-16 h-1 accent-blue-400 cursor-pointer"
                />
              </div>
            </div>

            {/* Time */}
            <span className="text-white/60 text-[11px] font-mono ml-1 tabular-nums">
              {fmtTime(currentTime)}
              {duration > 0 && <> / {fmtTime(duration)}</>}
            </span>

            <div className="flex-1" />

            {/* Subtitles */}
            {subtitles.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => { setShowSubs((v) => !v); setShowSettings(false); }}
                  className={`p-1.5 transition-colors ${activeSub ? "text-blue-400" : "text-white/50 hover:text-white"}`}
                  title="Subtitles / AI Translate"
                >
                  {translating
                    ? <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                    : <Subtitles className="w-4 h-4" />}
                </button>
                {showSubs && (
                  <div className="absolute bottom-full right-0 mb-2 min-w-[170px] max-h-80 overflow-y-auto bg-zinc-900 border border-white/10 rounded shadow-xl z-50">
                    <p className="px-3 py-1.5 text-[9px] font-mono text-white/30 uppercase tracking-widest border-b border-white/5">Subtitles</p>
                    <button
                      onClick={() => { setActiveSub(null); setShowSubs(false); }}
                      className={`w-full text-left px-3 py-2 text-[11px] font-mono transition-colors hover:bg-white/10 ${!activeSub ? "text-blue-400" : "text-white/60"}`}
                    >
                      Off
                    </button>
                    {subtitles.map((s) => (
                      <button
                        key={s.src}
                        onClick={() => { setActiveSub(s.src); setShowSubs(false); }}
                        className={`w-full text-left px-3 py-2 text-[11px] font-mono transition-colors hover:bg-white/10 ${activeSub === s.src ? "text-blue-400" : "text-white/60"}`}
                      >
                        {s.label}
                      </button>
                    ))}
                    <div className="border-t border-white/5 mt-1">
                      <p className="px-3 py-1.5 text-[9px] font-mono text-purple-400/70 uppercase tracking-widest flex items-center gap-1">
                        <Languages className="w-3 h-3" /> AI Translate
                      </p>
                      <div className="px-2 pb-2.5 flex gap-1.5">
                        <select
                          value={translateLang}
                          onChange={(e) => setTranslateLang(e.target.value)}
                          className="flex-1 bg-zinc-800 border border-white/10 text-[11px] text-white/70 px-1.5 py-1 rounded-sm outline-none cursor-pointer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {TRANSLATE_LANGS.map((l) => (
                            <option key={l.code} value={l.code}>{l.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => {
                            const lang = TRANSLATE_LANGS.find((l) => l.code === translateLang);
                            if (lang) { translateSubtitles(lang.code, lang.name); }
                            setShowSubs(false);
                          }}
                          disabled={translating}
                          className="px-2 py-1 text-[10px] font-mono bg-purple-500/20 text-purple-300 border border-purple-400/30 hover:bg-purple-500/30 transition-colors rounded-sm disabled:opacity-40 whitespace-nowrap"
                        >
                          {translating ? "…" : "Go"}
                        </button>
                      </div>
                      {translateError && (
                        <p className="px-2 pb-2 text-[9px] text-red-400 font-mono leading-tight">{translateError}</p>
                      )}
                      {currentTranslatedVtt && (
                        <div className="px-2 pb-2.5">
                          <button
                            onClick={() => {
                              const blob = new Blob([currentTranslatedVtt], { type: "text/plain" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = "subtitles_translated.txt";
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-mono bg-zinc-800/80 text-white/50 border border-white/10 hover:border-white/30 hover:text-white/80 transition-colors rounded-sm"
                          >
                            <Download className="w-3 h-3" /> Save .txt
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Quality */}
            {levels.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => { setShowSettings((v) => !v); setShowSubs(false); }}
                  className="p-1.5 text-white/50 hover:text-white transition-colors"
                  title="Quality"
                >
                  <Settings className="w-4 h-4" />
                </button>
                {showSettings && (
                  <div className="absolute bottom-full right-0 mb-2 min-w-[130px] bg-zinc-900 border border-white/10 rounded overflow-hidden shadow-xl z-50">
                    <p className="px-3 py-1.5 text-[9px] font-mono text-white/30 uppercase tracking-widest border-b border-white/5">Quality</p>
                    <button
                      onClick={() => setQuality(-1)}
                      className={`w-full text-left px-3 py-2 text-[11px] font-mono transition-colors hover:bg-white/10 ${currentLevel === -1 ? "text-blue-400" : "text-white/60"}`}
                    >
                      Auto
                    </button>
                    {[...levels].reverse().map((l, ri) => {
                      const idx = levels.length - 1 - ri;
                      return (
                        <button
                          key={idx}
                          onClick={() => setQuality(idx)}
                          className={`w-full text-left px-3 py-2 text-[11px] font-mono transition-colors hover:bg-white/10 ${currentLevel === idx ? "text-blue-400" : "text-white/60"}`}
                        >
                          {qualityLabel(l)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className="p-1.5 text-white/70 hover:text-white transition-colors"
              title="Fullscreen (F)"
            >
              {fullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Click anywhere on video to play/pause (not on controls) */}
      <div
        className="absolute inset-0 z-5 cursor-pointer"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button, input")) return;
          togglePlay();
          resetHideTimer();
        }}
      />
    </div>
  );
}

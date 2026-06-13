import { useRef, useState, useCallback, useEffect } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward, Settings } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface VideoPlayerProps {
  src: string;
  poster?: string;
  title?: string;
  onEnded?: () => void;
  episodeLabel?: string;
}

function formatTime(s: number) {
  if (!isFinite(s)) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function VideoPlayer({ src, poster, title, onEnded, episodeLabel }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!seeking) setShowControls(false);
    }, 3500);
  }, [seeking]);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      setLoading(true);
      v.play().catch(() => { setLoading(false); });
    } else {
      v.pause();
    }
  }, []);

  const skip = useCallback((secs: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.currentTime + secs, v.duration));
  }, []);

  const seekTo = useCallback((e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    const bar = progressRef.current;
    if (!v || !bar || !isFinite(v.duration)) return;
    const rect = bar.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const pos = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
    v.currentTime = pos * v.duration;
    setCurrentTime(v.currentTime);
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const changeVolume = useCallback((val: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = val;
    setVolume(val);
    if (val === 0) { v.muted = true; setMuted(true); }
    else if (muted) { v.muted = false; setMuted(false); }
  }, [muted]);

  const toggleFullscreen = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    if (!document.fullscreenElement) {
      c.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => {
      setCurrentTime(v.currentTime);
      if (v.buffered.length > 0) {
        setBuffered((v.buffered.end(v.buffered.length - 1) / v.duration) * 100);
      }
    };
    const onLoaded = () => { setDuration(v.duration); setLoading(false); };
    const onWaiting = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    const onError = () => { setError(true); setLoading(false); };
    const onEnded2 = () => { setPlaying(false); onEnded?.(); };

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("error", onError);
    v.addEventListener("ended", onEnded2);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("error", onError);
      v.removeEventListener("ended", onEnded2);
    };
  }, [onEnded]);

  useEffect(() => {
    setError(false);
    setLoading(true);
    setCurrentTime(0);
    setDuration(0);
    setPlaying(false);
  }, [src]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black select-none"
      onMouseMove={resetHideTimer}
      onMouseLeave={() => playing && setShowControls(false)}
      onTouchStart={resetHideTimer}
      style={{ cursor: showControls ? "default" : "none" }}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="w-full h-full object-contain"
        playsInline
        preload="metadata"
      />

      {/* Spinner when loading */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white animate-spin" />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80">
          <div className="w-12 h-12 border border-white/20 flex items-center justify-center">
            <span className="text-white/40 text-xl font-mono">!</span>
          </div>
          <p className="text-white/50 text-xs font-mono uppercase tracking-widest text-center px-6">
            Stream unavailable — this is a demo episode
          </p>
        </div>
      )}

      {/* Tap-to-play/pause on mobile */}
      <div className="absolute inset-0" onClick={toggle} />

      {/* Center play icon on pause */}
      <AnimatePresence>
        {!playing && !loading && !error && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div className="w-16 h-16 rounded-full bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center">
              <Play className="w-7 h-7 text-white fill-white ml-1" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controls */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 flex flex-col justify-end"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 35%, transparent 60%)" }}
          >
            {/* Title */}
            {(title || episodeLabel) && (
              <div className="absolute top-0 left-0 right-0 px-4 pt-4 pb-8 pointer-events-none"
                style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)" }}>
                {episodeLabel && (
                  <p className="text-white/50 text-[10px] font-mono uppercase tracking-[0.2em] mb-0.5">{episodeLabel}</p>
                )}
                {title && <p className="text-white text-sm font-medium truncate">{title}</p>}
              </div>
            )}

            <div className="px-4 pb-3" onClick={(e) => e.stopPropagation()}>
              {/* Progress bar */}
              <div
                ref={progressRef}
                className="relative h-1 bg-white/20 cursor-pointer mb-3 group/bar"
                style={{ touchAction: "none" }}
                onClick={seekTo}
                onMouseDown={() => setSeeking(true)}
                onMouseUp={() => setSeeking(false)}
              >
                <div className="absolute inset-y-0 left-0 bg-white/30 pointer-events-none" style={{ width: `${buffered}%` }} />
                <div className="absolute inset-y-0 left-0 bg-white pointer-events-none" style={{ width: `${progress}%` }} />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-lg opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none"
                  style={{ left: `${progress}%`, transform: `translateX(-50%) translateY(-50%)` }}
                />
              </div>

              {/* Buttons row */}
              <div className="flex items-center gap-2 sm:gap-3">
                <button onClick={toggle} className="text-white hover:text-white/70 transition-colors p-1" title={playing ? "Pause" : "Play"}>
                  {playing ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white" />}
                </button>
                <button onClick={() => skip(-10)} className="text-white/60 hover:text-white transition-colors p-1" title="Rewind 10s">
                  <SkipBack className="w-4 h-4" />
                </button>
                <button onClick={() => skip(10)} className="text-white/60 hover:text-white transition-colors p-1" title="Forward 10s">
                  <SkipForward className="w-4 h-4" />
                </button>

                {/* Volume */}
                <div className="relative flex items-center gap-1" onMouseEnter={() => setShowVolume(true)} onMouseLeave={() => setShowVolume(false)}>
                  <button onClick={toggleMute} className="text-white/60 hover:text-white transition-colors p-1" title={muted ? "Unmute" : "Mute"}>
                    {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                  <AnimatePresence>
                    {showVolume && (
                      <motion.input
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 64, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        type="range" min={0} max={1} step={0.05}
                        value={muted ? 0 : volume}
                        onChange={(e) => changeVolume(parseFloat(e.target.value))}
                        className="h-1 accent-white cursor-pointer"
                        style={{ width: 64 }}
                      />
                    )}
                  </AnimatePresence>
                </div>

                <span className="text-white/40 text-[10px] font-mono tabular-nums">
                  {formatTime(currentTime)}<span className="text-white/20 mx-0.5">/</span>{formatTime(duration)}
                </span>

                <div className="ml-auto flex items-center gap-1">
                  <button className="text-white/40 hover:text-white transition-colors p-1 hidden sm:block" title="Settings">
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={toggleFullscreen} className="text-white/60 hover:text-white transition-colors p-1" title={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
                    {fullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

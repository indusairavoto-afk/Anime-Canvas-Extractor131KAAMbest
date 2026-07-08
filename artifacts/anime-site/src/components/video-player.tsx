import { useRef, useState, useCallback, useEffect } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward, Settings, Camera, Gauge } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const HOLD_THRESHOLD_MS = 350;
const HOLD_SPEED = 2;

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

  // Cleanup hide timer on unmount
  useEffect(() => {
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, []);

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
  const [holding, setHolding] = useState(false);
  const [flash, setFlash] = useState(false);
  const [screenshotError, setScreenshotError] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenshotErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdActivated = useRef(false);
  const wasPlayingBeforeHold = useRef(false);

  // Cleanup hold/flash/error timers on unmount
  useEffect(() => {
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (screenshotErrorTimer.current) clearTimeout(screenshotErrorTimer.current);
    };
  }, []);

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

  const flashScreenshotError = useCallback(() => {
    setScreenshotError(true);
    if (screenshotErrorTimer.current) clearTimeout(screenshotErrorTimer.current);
    screenshotErrorTimer.current = setTimeout(() => setScreenshotError(false), 2500);
  }, []);

  const takeScreenshot = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    try {
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) { flashScreenshotError(); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${(title || "screenshot").replace(/[^\w\-]+/g, "_")}_${formatTime(v.currentTime).replace(/:/g, "-")}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    } catch {
      // Cross-origin CDN sources taint the canvas — toBlob throws SecurityError.
      flashScreenshotError();
      return;
    }
    setFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 180);
  }, [title, flashScreenshotError]);

  const endHold = useCallback(() => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    const v = videoRef.current;
    if (holdActivated.current) {
      holdActivated.current = false;
      setHolding(false);
      if (v) {
        v.playbackRate = 1;
        if (!wasPlayingBeforeHold.current) v.pause();
      }
      return true; // was a hold gesture, swallow the click
    }
    return false;
  }, []);

  const startHold = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const v = videoRef.current;
    wasPlayingBeforeHold.current = !!v && !v.paused;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      const vid = videoRef.current;
      if (!vid) return;
      holdActivated.current = true;
      setHolding(true);
      if (vid.paused) vid.play().catch(() => {});
      vid.playbackRate = HOLD_SPEED;
    }, HOLD_THRESHOLD_MS);
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

      {/* Screenshot flash */}
      <AnimatePresence>
        {flash && (
          <motion.div
            initial={{ opacity: 0.9 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-white pointer-events-none z-10"
          />
        )}
      </AnimatePresence>

      {/* Premium white loader */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <motion.div
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            className="relative w-12 h-12"
          >
            <div className="absolute inset-0 rounded-full border-[2.5px] border-white/10" />
            <div className="absolute inset-0 rounded-full border-[2.5px] border-transparent border-t-white animate-spin" />
          </motion.div>
        </div>
      )}

      {/* Screenshot unavailable toast — cross-origin sources can taint the canvas */}
      <AnimatePresence>
        {screenshotError && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute top-14 left-1/2 -translate-x-1/2 z-10 pointer-events-none"
          >
            <div className="flex items-center gap-2 bg-black/80 border border-white/15 backdrop-blur-sm px-3 py-1.5 rounded-full">
              <span className="text-white/80 text-[11px] font-mono">Screenshot unavailable for this source</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2x hold-to-fast-forward indicator */}
      <AnimatePresence>
        {holding && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur-md border border-white/15 pointer-events-none z-10"
          >
            <Gauge className="w-3.5 h-3.5 text-white" />
            <span className="text-white text-[11px] font-mono tracking-wider">{HOLD_SPEED}x</span>
          </motion.div>
        )}
      </AnimatePresence>

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

      {/* Tap-to-play/pause + hold-to-2x on mobile & desktop */}
      <div
        className="absolute inset-0"
        onPointerDown={startHold}
        onPointerUp={(e) => { if (!endHold()) toggle(); }}
        onPointerLeave={() => endHold()}
        onPointerCancel={() => endHold()}
      />

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
            className="absolute inset-0 flex flex-col justify-end backdrop-blur-[1px]"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.45) 35%, transparent 62%)" }}
          >
            {/* Title */}
            {(title || episodeLabel) && (
              <div className="absolute top-0 left-0 right-0 px-5 pt-5 pb-10 pointer-events-none"
                style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, transparent 100%)" }}>
                {episodeLabel && (
                  <p className="text-white/45 text-[10px] font-mono uppercase tracking-[0.25em] mb-1">{episodeLabel}</p>
                )}
                {title && <p className="text-white text-sm font-medium tracking-wide truncate">{title}</p>}
              </div>
            )}

            <div className="px-4 sm:px-5 pb-3.5" onClick={(e) => e.stopPropagation()}>
              {/* Progress bar */}
              <div
                ref={progressRef}
                className="relative h-[3px] hover:h-1.5 transition-[height] bg-white/15 cursor-pointer mb-3.5 group/bar rounded-full"
                style={{ touchAction: "none" }}
                onClick={seekTo}
                onMouseDown={() => setSeeking(true)}
                onMouseUp={() => setSeeking(false)}
              >
                <div className="absolute inset-y-0 left-0 bg-white/25 pointer-events-none rounded-full" style={{ width: `${buffered}%` }} />
                <div className="absolute inset-y-0 left-0 bg-white pointer-events-none rounded-full shadow-[0_0_8px_rgba(255,255,255,0.5)]" style={{ width: `${progress}%` }} />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.7)] opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none"
                  style={{ left: `${progress}%`, transform: `translateX(-50%) translateY(-50%)` }}
                />
              </div>

              {/* Buttons row */}
              <div className="flex items-center gap-1.5 sm:gap-2.5">
                <button onClick={toggle} className="text-white/90 hover:text-white transition-colors p-1.5 hover:scale-105 active:scale-95" title={playing ? "Pause" : "Play"}>
                  {playing ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white" />}
                </button>
                <button onClick={() => skip(-10)} className="text-white/55 hover:text-white transition-colors p-1.5 hover:scale-105 active:scale-95" title="Rewind 10s">
                  <SkipBack className="w-4 h-4" />
                </button>
                <button onClick={() => skip(10)} className="text-white/55 hover:text-white transition-colors p-1.5 hover:scale-105 active:scale-95" title="Forward 10s">
                  <SkipForward className="w-4 h-4" />
                </button>

                {/* Volume */}
                <div className="relative flex items-center gap-1" onMouseEnter={() => setShowVolume(true)} onMouseLeave={() => setShowVolume(false)}>
                  <button onClick={toggleMute} className="text-white/55 hover:text-white transition-colors p-1.5 hover:scale-105 active:scale-95" title={muted ? "Unmute" : "Mute"}>
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

                <span className="text-white/35 text-[10px] font-mono tabular-nums tracking-wide">
                  {formatTime(currentTime)}<span className="text-white/15 mx-0.5">/</span>{formatTime(duration)}
                </span>

                <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
                  <button onClick={takeScreenshot} className="text-white/55 hover:text-white transition-colors p-1.5 hover:scale-105 active:scale-95" title="Screenshot">
                    <Camera className="w-4 h-4" />
                  </button>
                  <button className="text-white/40 hover:text-white transition-colors p-1.5 hidden sm:block hover:scale-105 active:scale-95" title="Settings">
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={toggleFullscreen} className="text-white/55 hover:text-white transition-colors p-1.5 hover:scale-105 active:scale-95" title={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
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

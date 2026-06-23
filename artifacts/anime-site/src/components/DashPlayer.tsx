import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

interface Props {
  src: string;
  title?: string;
  progressKey?: string;
  onFatalError?: () => void;
}

export default function DashPlayer({ src, title, progressKey, onFatalError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoRef.current || !src) return;
    let destroyed = false;

    import("dashjs").then((mod) => {
      if (destroyed || !videoRef.current) return;
      // dashjs exports MediaPlayer as a named export
      const dashjs = mod.default ?? mod;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const factory = (dashjs as any).MediaPlayer;
      if (!factory) {
        setError("DASH player unavailable");
        setLoading(false);
        return;
      }

      const player = factory().create();
      playerRef.current = player;

      player.on("error", (e: unknown) => {
        if (destroyed) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg = (e as any)?.error?.message ?? "DASH stream error";
        setError(msg);
        setLoading(false);
        onFatalError?.();
      });

      player.on("playbackMetaDataLoaded", () => {
        if (destroyed) return;
        setLoading(false);
        // Restore saved progress
        if (progressKey) {
          try {
            const saved = localStorage.getItem(`progress_${progressKey}`);
            if (saved) {
              const { position, duration } = JSON.parse(saved);
              if (duration > 0 && position > 5 && position < duration - 10) {
                player.seek(position);
              }
            }
          } catch { /* ignore */ }
        }
      });

      player.on("playbackTimeUpdated", () => {
        if (destroyed || !videoRef.current) return;
        const time = player.time();
        const dur = player.duration();
        if (progressKey && dur > 0 && time > 0) {
          try {
            localStorage.setItem(`progress_${progressKey}`, JSON.stringify({ position: time, duration: dur }));
          } catch { /* ignore */ }
        }
      });

      player.initialize(videoRef.current, src, true);
      player.updateSettings({
        streaming: { abr: { autoSwitchBitrate: { video: true, audio: true } } },
        debug: { logLevel: 0 },
      });
    }).catch((err) => {
      if (destroyed) return;
      setError(String(err));
      setLoading(false);
    });

    return () => {
      destroyed = true;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (playerRef.current as any)?.destroy?.();
      } catch { /* ignore */ }
      playerRef.current = null;
    };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center">
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <Loader2 className="w-10 h-10 text-green-400 animate-spin opacity-80" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-black/80">
          <p className="text-red-400 text-sm font-mono">{error}</p>
          <button
            onClick={() => { setError(null); setLoading(true); }}
            className="text-[11px] font-mono px-4 py-1.5 border border-white/20 text-white/60 hover:border-white hover:text-white transition-colors"
          >
            Retry
          </button>
        </div>
      )}
      <video
        ref={videoRef}
        className="w-full h-full"
        controls
        title={title}
        playsInline
        style={{ display: loading && !error ? "none" : "block" }}
      />
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { apiUrl } from "@/lib/api";

const KEY = "anime-watch-progress";

interface Progress {
  watchedEpisodeIds: number[];
  lastWatched: Record<number, number>;
}

function load(): Progress {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") ?? { watchedEpisodeIds: [], lastWatched: {} };
  } catch {
    return { watchedEpisodeIds: [], lastWatched: {} };
  }
}

export interface WatchMeta {
  animeTitle?: string;
  coverImage?: string;
  episodeNumber?: number;
}

export function useWatchProgress() {
  const { user } = useAuth();
  const [progress, setProgress] = useState<Progress>(load);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(progress));
  }, [progress]);

  const markWatched = useCallback((episodeId: number, animeId: number, meta?: WatchMeta) => {
    setProgress((prev) => ({
      watchedEpisodeIds: prev.watchedEpisodeIds.includes(episodeId)
        ? prev.watchedEpisodeIds
        : [...prev.watchedEpisodeIds, episodeId],
      lastWatched: { ...prev.lastWatched, [animeId]: episodeId },
    }));
    if (user) {
      fetch(apiUrl("/api/history"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: user.username,
          animeId,
          episodeId,
          episodeNumber: meta?.episodeNumber ?? null,
          animeTitle: meta?.animeTitle ?? null,
          coverImage: meta?.coverImage ?? null,
        }),
      }).catch(() => {});
    }
  }, [user]);

  const isWatched = useCallback(
    (episodeId: number) => progress.watchedEpisodeIds.includes(episodeId),
    [progress]
  );

  const getLastWatched = useCallback(
    (animeId: number) => progress.lastWatched[animeId] ?? null,
    [progress]
  );

  const countWatched = useCallback(
    (episodeIds: number[]) =>
      episodeIds.filter((id) => progress.watchedEpisodeIds.includes(id)).length,
    [progress]
  );

  return { markWatched, isWatched, getLastWatched, countWatched };
}

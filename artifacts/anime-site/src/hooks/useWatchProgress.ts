import { useState, useEffect, useCallback } from "react";

const KEY = "anime-watch-progress";

interface Progress {
  watchedEpisodeIds: number[];
  lastWatched: Record<number, number>;
}

function load(): Progress {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") ?? {
      watchedEpisodeIds: [],
      lastWatched: {},
    };
  } catch {
    return { watchedEpisodeIds: [], lastWatched: {} };
  }
}

export function useWatchProgress() {
  const [progress, setProgress] = useState<Progress>(load);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(progress));
  }, [progress]);

  const markWatched = useCallback((episodeId: number, animeId: number) => {
    setProgress((prev) => ({
      watchedEpisodeIds: prev.watchedEpisodeIds.includes(episodeId)
        ? prev.watchedEpisodeIds
        : [...prev.watchedEpisodeIds, episodeId],
      lastWatched: { ...prev.lastWatched, [animeId]: episodeId },
    }));
  }, []);

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

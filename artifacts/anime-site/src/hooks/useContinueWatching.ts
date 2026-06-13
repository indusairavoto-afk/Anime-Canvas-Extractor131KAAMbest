import { useState, useEffect, useCallback } from "react";

const KEY = "na_continue_watching";
const MAX_ENTRIES = 20;

export interface ContinueWatchingEntry {
  animeId: number;
  episodeNumber: number;
  title: string;
  cover: string;
  banner?: string;
  totalEpisodes?: number;
  updatedAt: number;
}

function load(): ContinueWatchingEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") ?? [];
  } catch {
    return [];
  }
}

function save(entries: ContinueWatchingEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {}
}

export function useContinueWatching() {
  const [entries, setEntries] = useState<ContinueWatchingEntry[]>(load);

  useEffect(() => {
    save(entries);
  }, [entries]);

  const markProgress = useCallback(
    (entry: Omit<ContinueWatchingEntry, "updatedAt">) => {
      setEntries((prev) => {
        const filtered = prev.filter((e) => e.animeId !== entry.animeId);
        const updated: ContinueWatchingEntry = { ...entry, updatedAt: Date.now() };
        return [updated, ...filtered].slice(0, MAX_ENTRIES);
      });
    },
    []
  );

  const removeEntry = useCallback((animeId: number) => {
    setEntries((prev) => prev.filter((e) => e.animeId !== animeId));
  }, []);

  const clearAll = useCallback(() => {
    setEntries([]);
  }, []);

  return { entries, markProgress, removeEntry, clearAll };
}

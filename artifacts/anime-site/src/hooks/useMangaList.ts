import { useState, useEffect, useCallback } from "react";

export type ReadStatus = "reading" | "plan_to_read" | "completed";

export interface MangaEntry {
  id: number;
  status: ReadStatus;
  chapter: number;
  addedAt: number;
}

const KEY = "manga-readlist";

function load(): MangaEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    // Migrate old format: array of numbers
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "number") {
      return (raw as number[]).map((id) => ({
        id,
        status: "plan_to_read" as ReadStatus,
        chapter: 0,
        addedAt: Date.now(),
      }));
    }
    // Migrate entries missing chapter field
    return (raw as MangaEntry[]).map((e) => ({
      chapter: 0,
      ...e,
    }));
  } catch {
    return [];
  }
}

export function useMangaList() {
  const [entries, setEntries] = useState<MangaEntry[]>(load);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(entries));
  }, [entries]);

  const ids = entries.map((e) => e.id);

  const isInList = useCallback(
    (id: number) => entries.some((e) => e.id === id),
    [entries]
  );

  const getStatus = useCallback(
    (id: number): ReadStatus | null =>
      entries.find((e) => e.id === id)?.status ?? null,
    [entries]
  );

  const getChapter = useCallback(
    (id: number): number => entries.find((e) => e.id === id)?.chapter ?? 0,
    [entries]
  );

  const setStatus = useCallback((id: number, status: ReadStatus) => {
    setEntries((prev) => {
      const exists = prev.find((e) => e.id === id);
      if (exists) return prev.map((e) => (e.id === id ? { ...e, status } : e));
      return [...prev, { id, status, chapter: 0, addedAt: Date.now() }];
    });
  }, []);

  const setChapter = useCallback((id: number, chapter: number) => {
    const clamped = Math.max(0, chapter);
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, chapter: clamped } : e))
    );
  }, []);

  const remove = useCallback((id: number) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const toggle = useCallback((id: number) => {
    setEntries((prev) => {
      const exists = prev.find((e) => e.id === id);
      if (exists) return prev.filter((e) => e.id !== id);
      return [...prev, { id, status: "plan_to_read", chapter: 0, addedAt: Date.now() }];
    });
  }, []);

  const byStatus = useCallback(
    (status: ReadStatus) => entries.filter((e) => e.status === status),
    [entries]
  );

  return { entries, ids, isInList, getStatus, getChapter, setStatus, setChapter, remove, toggle, byStatus };
}

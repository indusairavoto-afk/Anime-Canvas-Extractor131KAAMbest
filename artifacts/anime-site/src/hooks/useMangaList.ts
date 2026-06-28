import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { apiUrl } from "@/lib/api";

export type ReadStatus = "reading" | "plan_to_read" | "completed";

export interface MangaEntry {
  id: number;
  status: ReadStatus;
  chapter: number;
  addedAt: number;
}

const LS_KEY = "manga-readlist";

function loadLocal(): MangaEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "number") {
      return (raw as number[]).map(id => ({ id, status: "plan_to_read" as ReadStatus, chapter: 0, addedAt: Date.now() }));
    }
    return (raw as any[]).map(e => ({ chapter: 0, ...e } as MangaEntry));
  } catch { return []; }
}

function saveLocal(entries: MangaEntry[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(entries));
}

export function useMangaList() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<MangaEntry[]>(loadLocal);
  const syncing = useRef(false);

  useEffect(() => {
    if (!user) {
      setEntries(loadLocal());
      return;
    }
    if (syncing.current) return;
    syncing.current = true;

    fetch(apiUrl(`/api/mangalist?username=${encodeURIComponent(user.username)}`))
      .then(r => r.ok ? r.json() : [])
      .then(async (remote: MangaEntry[]) => {
        const local = loadLocal();
        const remoteIds = new Set(remote.map(e => e.id));
        const toAdd = local.filter(e => !remoteIds.has(e.id));
        await Promise.allSettled(toAdd.map(e =>
          fetch(apiUrl("/api/mangalist"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: user.username, mangaId: e.id, status: e.status, chapter: e.chapter }),
          })
        ));
        const localMap = new Map(local.map(e => [e.id, e]));
        const merged: MangaEntry[] = [
          ...remote.map(r => localMap.has(r.id) ? { ...r, ...localMap.get(r.id)! } : r),
          ...toAdd,
        ];
        setEntries(merged);
        saveLocal(merged);
      })
      .catch(() => setEntries(loadLocal()))
      .finally(() => { syncing.current = false; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.username]);

  useEffect(() => { saveLocal(entries); }, [entries]);

  const ids = entries.map(e => e.id);
  const isInList = useCallback((id: number) => entries.some(e => e.id === id), [entries]);
  const getStatus = useCallback((id: number): ReadStatus | null => entries.find(e => e.id === id)?.status ?? null, [entries]);
  const getChapter = useCallback((id: number): number => entries.find(e => e.id === id)?.chapter ?? 0, [entries]);
  const byStatus = useCallback((status: ReadStatus) => entries.filter(e => e.status === status), [entries]);

  const setStatus = useCallback((id: number, status: ReadStatus) => {
    setEntries(prev => {
      const exists = prev.find(e => e.id === id);
      if (exists) return prev.map(e => e.id === id ? { ...e, status } : e);
      return [...prev, { id, status, chapter: 0, addedAt: Date.now() }];
    });
    if (user) {
      fetch(apiUrl(`/api/mangalist/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user.username, status }),
      }).catch(() => {});
    }
  }, [user]);

  const setChapter = useCallback((id: number, chapter: number) => {
    const clamped = Math.max(0, chapter);
    setEntries(prev => prev.map(e => e.id === id ? { ...e, chapter: clamped } : e));
    if (user) {
      fetch(apiUrl(`/api/mangalist/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user.username, chapter: clamped }),
      }).catch(() => {});
    }
  }, [user]);

  const remove = useCallback((id: number) => {
    setEntries(prev => prev.filter(e => e.id !== id));
    if (user) {
      fetch(apiUrl(`/api/mangalist/${id}`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user.username }),
      }).catch(() => {});
    }
  }, [user]);

  const toggle = useCallback((id: number) => {
    const exists = entries.find(e => e.id === id);
    if (exists) {
      remove(id);
    } else {
      const entry: MangaEntry = { id, status: "plan_to_read", chapter: 0, addedAt: Date.now() };
      setEntries(prev => [...prev, entry]);
      if (user) {
        fetch(apiUrl("/api/mangalist"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: user.username, mangaId: id, status: "plan_to_read", chapter: 0 }),
        }).catch(() => {});
      }
    }
  }, [entries, user, remove]);

  return { entries, ids, isInList, getStatus, getChapter, setStatus, setChapter, remove, toggle, byStatus };
}

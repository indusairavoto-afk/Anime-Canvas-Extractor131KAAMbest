import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { apiUrl } from "@/lib/api";

const LS_KEY = "anime-watchlist";

function loadLocal(): number[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]"); }
  catch { return []; }
}

function saveLocal(ids: number[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(ids));
}

export function useWatchlist() {
  const { user } = useAuth();
  const [ids, setIds] = useState<number[]>(loadLocal);
  const syncing = useRef(false);

  useEffect(() => {
    if (!user) {
      setIds(loadLocal());
      return;
    }
    if (syncing.current) return;
    syncing.current = true;

    fetch(apiUrl(`/api/watchlist?username=${encodeURIComponent(user.username)}`))
      .then(r => r.ok ? r.json() : [])
      .then(async (remote: { animeId: number }[]) => {
        const remoteIds = remote.map((r: { animeId: number }) => r.animeId);
        const local = loadLocal();
        const toAdd = local.filter(id => !remoteIds.includes(id));
        await Promise.allSettled(toAdd.map(id =>
          fetch(apiUrl("/api/watchlist"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: user.username, animeId: id }),
          })
        ));
        const merged = [...new Set([...remoteIds, ...local])];
        setIds(merged);
        saveLocal(merged);
      })
      .catch(() => setIds(loadLocal()))
      .finally(() => { syncing.current = false; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.username]);

  useEffect(() => { saveLocal(ids); }, [ids]);

  const toggle = useCallback(async (id: number) => {
    const removing = ids.includes(id);
    setIds(prev => removing ? prev.filter(x => x !== id) : [...prev, id]);

    if (user) {
      if (removing) {
        fetch(apiUrl(`/api/watchlist/${id}`), {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: user.username }),
        }).catch(() => {});
      } else {
        fetch(apiUrl("/api/watchlist"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: user.username, animeId: id }),
        }).catch(() => {});
      }
    }
  }, [ids, user]);

  const isInList = useCallback((id: number) => ids.includes(id), [ids]);

  return { ids, toggle, isInList };
}

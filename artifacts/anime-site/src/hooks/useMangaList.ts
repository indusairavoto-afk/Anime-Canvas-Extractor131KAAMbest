import { useState, useEffect, useCallback } from "react";

const KEY = "manga-readlist";

function load(): number[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function useMangaList() {
  const [ids, setIds] = useState<number[]>(load);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(ids));
  }, [ids]);

  const toggle = useCallback((id: number) => {
    setIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const isInList = useCallback((id: number) => ids.includes(id), [ids]);

  return { ids, toggle, isInList };
}

import { Router } from "express";

const router = Router();

const SEARCH_URL = "https://atsu.moe/collections/manga/documents/search";
const MANGA_BASE = "https://atsu.moe/manga";

interface AtsuChapter {
  id: string;
  number: number;
  title: string | null;
  pageCount: number;
  index: number;
}

interface AtsuSearchDoc {
  id: string;
  title: string;
  englishTitle?: string;
  chapterCount?: number;
}

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://atsu.moe",
  "Referer": "https://atsu.moe/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

async function searchAtsu(query: string, perPage = 5): Promise<AtsuSearchDoc[]> {
  const params = new URLSearchParams({
    q: query,
    query_by: "title,englishTitle,otherNames",
    per_page: String(perPage),
    include_fields: "id,title,englishTitle,chapterCount",
  });
  const res = await fetch(`${SEARCH_URL}?${params}`, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`atsu search HTTP ${res.status}`);
  const json = await res.json() as { hits?: { document: AtsuSearchDoc }[] };
  return (json.hits ?? []).map(h => h.document);
}

async function fetchChapters(mangaId: string): Promise<AtsuChapter[]> {
  const res = await fetch(`${MANGA_BASE}/${mangaId}`, {
    headers: {
      ...BROWSER_HEADERS,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": "https://atsu.moe/",
    },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const match = html.match(/window\.mangaPage\s*=\s*(\{.+?\});?\s*<\/script>/s);
  if (!match) return [];
  try {
    const data = JSON.parse(match[1]) as { mangaPage?: { chapters?: AtsuChapter[] } };
    const chapters = data.mangaPage?.chapters ?? [];
    return [...chapters].reverse();
  } catch {
    return [];
  }
}

function pickBestMatch(results: AtsuSearchDoc[], title: string): AtsuSearchDoc | null {
  if (!results.length) return null;
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = normalise(title);
  for (const r of results) {
    const t = normalise(r.englishTitle ?? r.title);
    if (t === target) return r;
  }
  for (const r of results) {
    const t = normalise(r.title);
    if (t === target) return r;
  }
  return results[0];
}

const HIDE_BOTTOM_UI = `<style id="na-atsu-hide">
html,body{margin:0!important;padding:0!important}
</style>
<script>
(function() {
  function norm(s) { return (s || '').trim().toLowerCase(); }

  function findTabBar() {
    var candidates = document.querySelectorAll('button, a, div, span, li');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.children.length > 2) continue;
      if (norm(el.textContent) !== 'comments') continue;
      var p = el.parentElement;
      for (var depth = 0; p && depth < 6; depth++, p = p.parentElement) {
        var pt = norm(p.textContent);
        if (pt.indexOf('chapters') !== -1 && pt.indexOf('reading') !== -1 && pt.length < 200) {
          return p;
        }
      }
    }
    return null;
  }

  function hideBottomUi() {
    var tabBar = findTabBar();
    if (!tabBar || tabBar.getAttribute('data-na-hidden') === '1') return !!tabBar;
    tabBar.setAttribute('data-na-hidden', '1');
    tabBar.style.setProperty('display', 'none', 'important');

    // Hide the "Manga Info / Next Chapter" row that sits just above the tabs,
    // if present, since it duplicates our own reader toolbar navigation.
    var prevRow = tabBar.previousElementSibling;
    if (prevRow) {
      var pt = norm(prevRow.textContent);
      if (pt.indexOf('manga info') !== -1 || pt.indexOf('next chapter') !== -1) {
        prevRow.style.setProperty('display', 'none', 'important');
      }
    }

    // Hide everything that follows the tab bar at every ancestor level up to
    // <body>, since the comments panel/bookmark row live as later siblings
    // somewhere in that chain rather than all inside the tab bar itself.
    var node = tabBar;
    while (node && node !== document.body) {
      var sib = node.nextElementSibling;
      while (sib) {
        sib.style.setProperty('display', 'none', 'important');
        sib = sib.nextElementSibling;
      }
      node = node.parentElement;
    }
    return true;
  }

  hideBottomUi();
  var obs = new MutationObserver(hideBottomUi);
  obs.observe(document.documentElement, { childList: true, subtree: true });
  var tries = 0;
  var iv = setInterval(function() {
    tries++;
    if (hideBottomUi() || tries > 60) clearInterval(iv);
  }, 500);
})();
</script>`;

router.get("/atsu/proxy", async (req, res) => {
  const mangaId = String(req.query.mangaId ?? "").trim();
  const chapterId = String(req.query.chapterId ?? "").trim();

  if (!mangaId || !chapterId) {
    res.status(400).send("mangaId and chapterId are required");
    return;
  }

  const target = `https://atsu.moe/read/${encodeURIComponent(mangaId)}/${encodeURIComponent(chapterId)}`;

  try {
    const upstream = await fetch(target, {
      headers: {
        ...BROWSER_HEADERS,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!upstream.ok) {
      res.status(502).send("Failed to load reader from atsu.moe");
      return;
    }

    let html = await upstream.text();

    const baseTag = `<base href="https://atsu.moe/" />`;
    const injected = `${baseTag}${HIDE_BOTTOM_UI}`;

    if (html.includes("<head>")) {
      html = html.replace("<head>", `<head>${injected}`);
    } else {
      html = html.replace(/<head[^>]*>/, (m) => `${m}${injected}`);
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(html);
  } catch (err) {
    console.error("[atsu] proxy error:", err);
    res.status(502).send("Failed to load reader from atsu.moe");
  }
});

router.get("/atsu/find", async (req, res) => {
  const title = String(req.query.title ?? "").trim();
  if (!title) {
    res.json({ found: false });
    return;
  }

  try {
    let results = await searchAtsu(title, 5);
    let match = pickBestMatch(results, title);

    if (!match) {
      const shorter = title.split(":")[0].trim();
      if (shorter !== title) {
        results = await searchAtsu(shorter, 5);
        match = pickBestMatch(results, shorter);
      }
    }

    if (!match) {
      res.json({ found: false });
      return;
    }

    const chapters = await fetchChapters(match.id);
    res.json({
      found: true,
      mangaId: match.id,
      title: match.englishTitle ?? match.title,
      chapters,
    });
  } catch (err) {
    console.error("[atsu] find error:", err);
    res.json({ found: false, error: true });
  }
});

export default router;

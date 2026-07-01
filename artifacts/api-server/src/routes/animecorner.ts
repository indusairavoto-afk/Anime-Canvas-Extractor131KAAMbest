import { Router } from "express";

const router = Router();

const BASE = "https://animecorner.me";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

interface CacheEntry { data: unknown; expiresAt: number; }
const cache = new Map<string, CacheEntry>();
function getCached(key: string) {
  const e = cache.get(key);
  if (!e || Date.now() > e.expiresAt) { cache.delete(key); return null; }
  return e.data;
}
function setCache(key: string, data: unknown, ttlMs = 10 * 60 * 1000) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  if (cache.size > 200) { const k = cache.keys().next().value; if (k) cache.delete(k); }
}

function decodeHtml(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function extract(html: string, re: RegExp, group = 1): string {
  const m = re.exec(html);
  return m ? decodeHtml(m[group]) : "";
}

export interface NewsArticleSummary {
  slug: string;
  title: string;
  url: string;
  image: string;
  author: string;
  date: string;
  categories: string[];
}

function parseListingArticles(html: string): NewsArticleSummary[] {
  const articles: NewsArticleSummary[] = [];
  const artRe = /<article[^>]*class="[^"]*item hentry[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  let m: RegExpExecArray | null;
  while ((m = artRe.exec(html)) !== null) {
    const a = m[1];

    // Image: prefer data-bgset, fall back to data-bglqip
    const image =
      extract(a, /data-bgset="(https:\/\/[^"]+\.(jpg|png|webp)[^"]*)"/, 1) ||
      extract(a, /data-bglqip="(https:\/\/[^"]+\.(jpg|png|webp)[^"]*)"/, 1);
    // Remove -lqip suffix and size suffix if present for full quality
    const cleanImage = image.replace(/-lqip\./, ".").replace(/-768x432-lqip/, "");

    // Title + URL
    const titleMatch = /<h2[^>]*class="[^"]*penci-entry-title[^"]*"[^>]*>\s*<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/i.exec(a);
    if (!titleMatch) continue;
    const url = titleMatch[1];
    const title = decodeHtml(titleMatch[2]);
    const slug = url.replace(`${BASE}/`, "").replace(/\/$/, "");

    // Author
    const author = extract(a, /<a[^>]*class="[^"]*author-url[^"]*"[^>]*>([^<]+)<\/a>/);

    // Date
    const date = extract(a, /<time[^>]*class="[^"]*entry-date[^"]*"[^>]*>([^<]+)<\/time>/);

    // Categories
    const cats: string[] = [];
    const catRe = /href="https:\/\/animecorner\.me\/category\/[^"]+">([^<]+)<\/a>/g;
    let cm: RegExpExecArray | null;
    while ((cm = catRe.exec(a)) !== null) cats.push(decodeHtml(cm[1]));

    articles.push({ slug, title, url, image: cleanImage || image, author, date, categories: cats });
  }
  return articles;
}

export interface NewsArticleFull extends NewsArticleSummary {
  description: string;
  publishedAt: string;
  content: string;
  tags: string[];
  related: NewsArticleSummary[];
}

function cleanContentHtml(html: string): string {
  return html
    // Remove scripts, styles, noscript, ins (ads), iframes
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<ins[\s\S]*?<\/ins>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    // Remove social share divs and related widgets
    .replace(/<div[^>]*class="[^"]*(?:sharedaddy|jp-relatedposts|wpcnt|penci-share|penci-nav|post-nav)[^"]*"[\s\S]*?<\/div>/gi, "")
    // Fix lazy images: animecorner uses data-src with a placeholder SVG in the real src attr
    // Step 1: remove the SVG placeholder src entirely so it doesn't override data-src
    .replace(/\s*src="data:[^"]*"/gi, "")
    // Step 2: promote data-src to src
    .replace(/\s*data-src="([^"]+)"/gi, ' src="$1"')
    // Clean up data-srcset, data-sizes, srcset, sizes
    .replace(/\s*data-srcset="[^"]*"/gi, "")
    .replace(/\s*data-sizes="[^"]*"/gi, "")
    .replace(/\s*srcset="[^"]*"/gi, "")
    .replace(/\s*sizes="[^"]*"/gi, "")
    .replace(/\s*loading="[^"]*"/gi, "")
    .replace(/\s*decoding="[^"]*"/gi, "")
    // Clean up empty paragraphs
    .replace(/<p[^>]*>\s*<\/p>/gi, "")
    .trim();
}

// GET /api/animecorner/news?page=1&category=anime-news
router.get("/animecorner/news", async (req, res) => {
  const page = parseInt((req.query.page as string) || "1", 10) || 1;
  const category = (req.query.category as string) || "anime-news";
  const cacheKey = `ac-news-${category}-${page}`;
  const cached = getCached(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    const url = page === 1
      ? `${BASE}/category/${category}/`
      : `${BASE}/category/${category}/page/${page}/`;

    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) { res.status(resp.status).json({ error: `animecorner returned ${resp.status}` }); return; }
    const html = await resp.text();
    const articles = parseListingArticles(html);

    // Check for next page
    const hasNextPage = /class="[^"]*next[^"]*"/.test(html) || new RegExp(`/category/${category}/page/${page + 1}/`).test(html);

    const result = { articles, page, hasNextPage };
    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch animecorner news" });
  }
});

// GET /api/animecorner/article/:slug
router.get("/animecorner/article/:slug", async (req, res) => {
  const slug = req.params.slug;
  const cacheKey = `ac-article-${slug}`;
  const cached = getCached(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    const url = `${BASE}/${slug}/`;
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) { res.status(resp.status).json({ error: `animecorner returned ${resp.status}` }); return; }
    const html = await resp.text();

    // OG meta tags
    const title = decodeHtml(extract(html, /<meta property="og:title" content="([^"]+)"/));
    const description = decodeHtml(extract(html, /<meta property="og:description" content="([^"]+)"/));
    const image = extract(html, /<meta property="og:image" content="([^"]+)"/);
    const publishedAt = extract(html, /<meta property="article:published_time" content="([^"]+)"/);

    // Author from byline
    const author = extract(html, /<span[^>]*class="[^"]*author-post[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/);

    // Categories
    const cats: string[] = [];
    const catRe = /href="https:\/\/animecorner\.me\/category\/[^"]+">([^<]+)<\/a>/g;
    let cm: RegExpExecArray | null;
    while ((cm = catRe.exec(html)) !== null) {
      const cat = decodeHtml(cm[1]);
      if (!cats.includes(cat)) cats.push(cat);
    }

    // Tags
    const tags: string[] = [];
    const tagRe = /href="https:\/\/animecorner\.me\/tag\/[^"]+">([^<]+)<\/a>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tagRe.exec(html)) !== null) {
      const tag = decodeHtml(tm[1]);
      if (!tags.includes(tag)) tags.push(tag);
    }

    // Article content
    const contentMatch = /<div[^>]*class="[^"]*inner-post-entry entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class="[^"]*(?:penci-post-tags|author-box|related|comments)[^"]*"/i.exec(html);
    const rawContent = contentMatch ? contentMatch[1] : "";
    const content = cleanContentHtml(rawContent);

    // Date from time element
    const date = extract(html, /<time[^>]*class="[^"]*entry-date[^"]*"[^>]*>([^<]+)<\/time>/);

    // Article URL slug
    const articleUrl = `${BASE}/${slug}/`;

    // Fetch related articles (latest news, exclude current slug)
    let related: NewsArticleSummary[] = [];
    try {
      const relatedCacheKey = `ac-news-anime-news-1`;
      let listing = getCached(relatedCacheKey) as { articles: NewsArticleSummary[] } | null;
      if (!listing) {
        const listResp = await fetch(`${BASE}/category/anime-news/`, { headers: HEADERS });
        if (listResp.ok) {
          const listHtml = await listResp.text();
          const articles = parseListingArticles(listHtml);
          listing = { articles };
          setCache(relatedCacheKey, { articles, page: 1, hasNextPage: true }, 15 * 60 * 1000);
        }
      }
      if (listing) {
        related = (listing.articles as NewsArticleSummary[])
          .filter((a) => a.slug !== slug)
          .slice(0, 3);
      }
    } catch (_) { /* related is best-effort */ }

    const result: NewsArticleFull = {
      slug,
      title: title || decodeHtml(extract(html, /<title>([^<|]+)/)),
      url: articleUrl,
      image,
      author,
      date,
      categories: cats.slice(0, 5),
      description,
      publishedAt,
      content,
      tags: tags.slice(0, 10),
      related,
    };

    setCache(cacheKey, result, 30 * 60 * 1000); // 30min cache for articles
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch article" });
  }
});

export default router;

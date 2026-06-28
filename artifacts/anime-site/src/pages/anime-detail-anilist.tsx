import { motion, AnimatePresence } from "framer-motion";
import { apiUrl } from "@/lib/api";
import { Link, useParams } from "wouter";
import { SeriesRatingGauge } from "@/components/SeriesRatingGauge";
import {
  ArrowLeft, Star, Calendar, Tv, Bookmark, BookmarkCheck,
  Play, Film, ThumbsUp, MessageCircle, Send, X,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useWatchlist } from "@/hooks/useWatchlist";
import {
  useListAnimeReviews,
  getListAnimeReviewsQueryKey,
  useCreateAnimeReview,
  useGetAnimeReviewSummary,
  getGetAnimeReviewSummaryQueryKey,
  useLikeReview,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";

type RatingOption = "skip" | "timepass" | "go_for_it" | "perfection";

const RATING_OPTIONS: { value: RatingOption; label: string; color: string; dot: string; bg: string; border: string }[] = [
  { value: "skip",       label: "Skip",       color: "text-red-400",    dot: "bg-red-400",    bg: "bg-red-400/10",    border: "border-red-400/40" },
  { value: "timepass",   label: "Timepass",   color: "text-yellow-400", dot: "bg-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/40" },
  { value: "go_for_it",  label: "Go for it",  color: "text-green-400",  dot: "bg-green-400",  bg: "bg-green-400/10",  border: "border-green-400/40" },
  { value: "perfection", label: "Perfection", color: "text-purple-400", dot: "bg-purple-400", bg: "bg-purple-400/10", border: "border-purple-400/40" },
];

function getRatingConfig(rating: RatingOption) {
  return RATING_OPTIONS.find((r) => r.value === rating)!;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const STATUS_LABEL: Record<string, string> = {
  FINISHED: "Completed",
  RELEASING: "Ongoing",
  NOT_YET_RELEASED: "Upcoming",
  CANCELLED: "Cancelled",
  HIATUS: "On Hiatus",
};

const STREAM_PRIORITY = [
  "Crunchyroll", "Netflix", "Funimation", "HIDIVE", "Hulu",
  "Amazon Prime Video", "Disney Plus", "Adult Swim",
];

interface ExternalLink { url: string; site: string; type: string; }
interface VoiceActor { id: number; name: { full: string; native?: string | null }; image: { large?: string; medium?: string }; }
interface CharacterEdge { node: { id: number; name: { full: string }; image: { large?: string; medium?: string } }; voiceActors: VoiceActor[]; }

interface AniMedia {
  id: number;
  title: { romaji: string; english?: string | null; native?: string | null };
  description?: string | null;
  coverImage: { extraLarge?: string; large?: string };
  bannerImage?: string | null;
  genres: string[];
  averageScore?: number | null;
  status: string;
  seasonYear?: number | null;
  format?: string | null;
  episodes?: number | null;
  duration?: number | null;
  studios?: { nodes: { name: string }[] };
  trailer?: { id: string; site: string } | null;
  externalLinks?: ExternalLink[];
  characters?: { edges: CharacterEdge[] };
  recommendations?: {
    nodes: {
      mediaRecommendation?: {
        id: number;
        title: { romaji: string; english?: string | null };
        coverImage: { large?: string };
        averageScore?: number | null;
      } | null;
    }[];
  };
}

const DETAIL_QUERY = `
query ($id: Int!) {
  Media(id: $id, type: ANIME) {
    id
    title { romaji english native }
    description(asHtml: false)
    coverImage { extraLarge large }
    bannerImage
    genres
    averageScore
    status
    seasonYear
    format
    episodes
    duration
    studios(isMain: true) { nodes { name } }
    trailer { id site }
    externalLinks { url site type }
    characters(role: MAIN, sort: [ROLE, RELEVANCE], perPage: 12) {
      edges {
        node { id name { full } image { large medium } }
        voiceActors(language: JAPANESE) {
          id name { full native } image { large medium }
        }
      }
    }
    recommendations(perPage: 6, sort: [RATING_DESC]) {
      nodes {
        mediaRecommendation {
          id
          title { romaji english }
          coverImage { large }
          averageScore
        }
      }
    }
  }
}`;

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
    .trim();
}

function getBestStreamLink(links: ExternalLink[], anilistId: number): { url: string; site: string } {
  const streaming = links.filter((l) => l.type === "STREAMING");
  for (const name of STREAM_PRIORITY) {
    const match = streaming.find((l) => l.site === name);
    if (match) return { url: match.url, site: match.site };
  }
  if (streaming[0]) return { url: streaming[0].url, site: streaming[0].site };
  return { url: `https://anilist.co/anime/${anilistId}`, site: "AniList" };
}

export default function AnimeDetailAniList() {
  const params = useParams<{ id: string }>();
  const anilistId = parseInt(params.id ?? "0");
  const { toggle, isInList } = useWatchlist();
  const saved = isInList(anilistId);
  const queryClient = useQueryClient();
  const { user: authUser } = useAuth();

  const [anime, setAnime] = useState<AniMedia | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [trailerFailed, setTrailerFailed] = useState(false);

  const [selectedRating, setSelectedRating] = useState<RatingOption | null>(null);
  const [reviewText, setReviewText] = useState("");
  const [username, setUsername] = useState("");
  const [isSpoiler, setIsSpoiler] = useState(false);
  const [revealedIds, setRevealedIds] = useState<Set<number>>(new Set());
  const [likedIds, setLikedIds] = useState<Set<number>>(new Set());
  const [showSpoilers, setShowSpoilers] = useState(false);
  const [sortOrder, setSortOrder] = useState<"liked" | "newest" | "oldest">("liked");
  const textRef = useRef<HTMLTextAreaElement>(null);

  type ReplyItem = { id: number; reviewId: number; username: string; avatarUrl: string; content: string; likes: number; createdAt: string };
  const [expandedReplies, setExpandedReplies] = useState<Set<number>>(new Set());
  const [repliesData, setRepliesData] = useState<Record<number, ReplyItem[]>>({});
  const [replyText, setReplyText] = useState<Record<number, string>>({});
  const [replySubmitting, setReplySubmitting] = useState<Set<number>>(new Set());
  const [showReviewsModal, setShowReviewsModal] = useState(false);

  async function loadReplies(reviewId: number) {
    const res = await fetch(apiUrl(`/api/reviews/${reviewId}/replies`));
    if (res.ok) {
      const data = await res.json();
      setRepliesData(prev => ({ ...prev, [reviewId]: data }));
    }
  }

  function toggleReplies(reviewId: number) {
    setExpandedReplies(prev => {
      const next = new Set(prev);
      if (next.has(reviewId)) { next.delete(reviewId); }
      else { next.add(reviewId); loadReplies(reviewId); }
      return next;
    });
  }

  async function submitReply(reviewId: number) {
    const content = (replyText[reviewId] || "").trim();
    if (!content) return;
    setReplySubmitting(prev => new Set(prev).add(reviewId));
    const name = authUser?.username || username.trim() || "Guest";
    const res = await fetch(apiUrl(`/api/reviews/${reviewId}/replies`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: name, content }),
    });
    if (res.ok) {
      setReplyText(prev => ({ ...prev, [reviewId]: "" }));
      await loadReplies(reviewId);
    }
    setReplySubmitting(prev => { const next = new Set(prev); next.delete(reviewId); return next; });
  }

  const { data: reviews, isLoading: reviewsLoading } = useListAnimeReviews(anilistId, {
    query: { enabled: !!anilistId, queryKey: getListAnimeReviewsQueryKey(anilistId) },
  });
  const { data: reviewSummary } = useGetAnimeReviewSummary(anilistId, {
    query: { enabled: !!anilistId, queryKey: getGetAnimeReviewSummaryQueryKey(anilistId) },
  });
  const { mutate: createReview, isPending: submitting } = useCreateAnimeReview({
    mutation: {
      onSuccess: () => {
        setReviewText("");
        setSelectedRating(null);
        setIsSpoiler(false);
        queryClient.invalidateQueries({ queryKey: getListAnimeReviewsQueryKey(anilistId) });
        queryClient.invalidateQueries({ queryKey: getGetAnimeReviewSummaryQueryKey(anilistId) });
      },
    },
  });
  const { mutate: likeReviewMutation } = useLikeReview({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAnimeReviewsQueryKey(anilistId) });
      },
    },
  });

  function handleRatingSelect(r: RatingOption) {
    setSelectedRating(r);
    setTimeout(() => textRef.current?.focus(), 50);
  }

  function handleSubmit() {
    if (!selectedRating || reviewText.trim().length === 0) return;
    const name = authUser?.username || username.trim() || "Guest";
    createReview({ id: anilistId, data: { username: name, rating: selectedRating, content: reviewText.trim(), spoiler: isSpoiler } });
  }

  function handleLike(reviewId: number) {
    if (likedIds.has(reviewId)) return;
    setLikedIds((prev) => new Set(prev).add(reviewId));
    likeReviewMutation({ id: reviewId });
  }

  useEffect(() => {
    if (!anilistId) return;
    setLoading(true);
    setError(false);
    fetch(apiUrl("/api/anilist"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: DETAIL_QUERY, variables: { id: anilistId } }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (json?.data?.Media) setAnime(json.data.Media);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [anilistId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black">
        <div className="h-[40vh] bg-zinc-950 animate-pulse" />
        <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-16 py-16 space-y-6">
          <div className="h-12 bg-white/5 w-1/2 animate-pulse" />
          <div className="h-4 bg-white/5 w-full animate-pulse" />
          <div className="h-4 bg-white/5 w-3/4 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !anime) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4">
        <p className="text-white/40 font-mono">Anime not found</p>
        <Link href="/browse" className="text-[10px] font-mono uppercase tracking-widest border border-white/10 text-white/40 hover:text-white px-4 py-2 transition-colors">
          Back to Browse
        </Link>
      </div>
    );
  }

  const title = anime.title.english || anime.title.romaji;
  const romaji = anime.title.english ? anime.title.romaji : anime.title.native;
  const cover = anime.coverImage?.extraLarge || anime.coverImage?.large || "";
  const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
  const studio = anime.studios?.nodes?.[0]?.name;
  const description = anime.description ? stripHtml(anime.description) : null;
  const recs = (anime.recommendations?.nodes ?? [])
    .map((n) => n.mediaRecommendation)
    .filter(Boolean)
    .slice(0, 6);
  const characterEdges = anime.characters?.edges ?? [];
  const streamLink = getBestStreamLink(anime.externalLinks ?? [], anime.id);

  const isUpcoming = anime.status === "NOT_YET_RELEASED";
  const hasYouTubeTrailer = anime.trailer?.site === "youtube" && !!anime.trailer?.id;
  const showVideoHero = hasYouTubeTrailer && !trailerFailed;

  return (
    <>
    <div className="bg-black text-white min-h-screen -mt-14">
      {/* Banner hero */}
      <div className="relative h-[55vh] sm:h-[70vh] overflow-hidden">

        {/* ── Video background (all anime with trailer) ── */}
        {showVideoHero ? (
          <>
            {/* Container clips iframe edges where YouTube logo/controls appear */}
            <div className="absolute inset-0 overflow-hidden bg-black">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${anime.trailer!.id}?autoplay=1&mute=1&loop=1&playlist=${anime.trailer!.id}&controls=0&modestbranding=1&showinfo=0&rel=0&iv_load_policy=3&disablekb=1&fs=0&cc_load_policy=3&enablejsapi=0&origin=${encodeURIComponent(window.location.origin)}`}
                allow="autoplay; encrypted-media"
                className="absolute border-0"
                style={{
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  /* Oversized so YouTube UI at edges is clipped by overflow:hidden */
                  width: "max(177.78vh, 140%)",
                  height: "max(56.25vw, 140%)",
                  minWidth: "140%",
                  minHeight: "140%",
                  pointerEvents: "none",
                  filter: "brightness(0.52) contrast(1.08) saturate(1.1)",
                }}
              />
              {/* Transparent blocker: sits above the iframe, intercepts any
                  mouse events so YouTube never receives hover → controls stay hidden */}
              <div className="absolute inset-0 z-[1]" style={{ pointerEvents: "auto", background: "transparent" }} />
            </div>

            {/* Upcoming badge — only for upcoming status */}
            {isUpcoming && (
              <div className="absolute top-20 right-4 sm:right-8 lg:right-16 z-10">
                <span className="flex items-center gap-1.5 bg-white/10 backdrop-blur border border-white/20 text-white text-[10px] font-mono uppercase tracking-widest px-3 py-1.5 rounded-full">
                  <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />
                  Upcoming · Trailer
                </span>
              </div>
            )}
          </>
        ) : anime.bannerImage ? (
          <img
            src={anime.bannerImage}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: "brightness(0.62) contrast(1.05)" }}
          />
        ) : (
          <div
            className="absolute inset-0 w-full h-full"
            style={{
              backgroundImage: `url(${cover})`,
              backgroundSize: "cover",
              backgroundPosition: "center 20%",
              filter: "brightness(0.2) blur(20px)",
              transform: "scale(1.1)",
            }}
          />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent" />
        <div className="absolute top-24 sm:top-24 left-4 sm:left-8 lg:left-16">
          <Link href="/browse" className="flex items-center gap-2 text-white/50 hover:text-white text-xs sm:text-sm font-mono uppercase tracking-widest transition-colors">
            <ArrowLeft className="w-4 h-4" /> Browse
          </Link>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-16 -mt-36 sm:-mt-48 relative z-10 pb-16 sm:pb-24">
        <div className="flex gap-4 sm:gap-8">
          {/* Cover poster */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6 }}
            className="flex-shrink-0 w-28 sm:w-48"
          >
            <div className="aspect-[2/3] border border-white/10 overflow-hidden shadow-2xl">
              <img src={cover} alt={title} className="w-full h-full object-cover" />
            </div>
          </motion.div>

          {/* Info */}
          <div className="flex-1 pt-20 sm:pt-28 min-w-0">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              {romaji && romaji !== title && (
                <p className="hidden sm:block text-white/30 font-mono text-xs tracking-widest uppercase mb-2">{romaji}</p>
              )}
              <h1 className="font-serif text-3xl sm:text-5xl lg:text-6xl text-white leading-tight mb-3 sm:mb-4">{title}</h1>

              {/* Stats */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4 sm:mb-6 text-xs font-mono text-white/50 uppercase tracking-widest">
                {score && <span className="flex items-center gap-1.5"><Star className="w-3 h-3" />{score}</span>}
                {anime.seasonYear && <span className="flex items-center gap-1.5"><Calendar className="w-3 h-3" />{anime.seasonYear}</span>}
                {anime.episodes && <span className="hidden sm:flex items-center gap-1.5"><Tv className="w-3 h-3" />{anime.episodes} eps</span>}
                <span className={`px-2 py-0.5 border text-[9px] ${anime.status === "RELEASING" ? "border-white/40 text-white" : "border-white/10 text-white/40"}`}>
                  {STATUS_LABEL[anime.status] ?? anime.status}
                </span>
                {anime.format && (
                  <span className="px-2 py-0.5 border border-white/10 text-[9px] flex items-center gap-1">
                    <Film className="w-2.5 h-2.5" />{anime.format.replace("_", " ")}
                  </span>
                )}
              </div>

              {/* Genres */}
              <div className="hidden sm:flex flex-wrap gap-2 mb-6">
                {anime.genres.map((g) => (
                  <Link key={g} href={`/browse?genre=${encodeURIComponent(g)}`}>
                    <span className="text-[10px] font-mono uppercase tracking-widest border border-white/10 px-3 py-1 text-white/50 hover:border-white/30 hover:text-white transition-colors cursor-pointer">{g}</span>
                  </Link>
                ))}
              </div>

              {description && (
                <p className="hidden sm:block text-white/70 leading-relaxed max-w-2xl mb-4 sm:mb-6 text-sm">
                  {description.length > 600 ? description.slice(0, 600) + "…" : description}
                </p>
              )}
              {studio && (
                <p className="hidden sm:block text-white/30 text-xs font-mono uppercase tracking-widest mb-6 sm:mb-8">
                  Studio: {studio}{anime.duration ? ` · ${anime.duration} min/ep` : ""}
                </p>
              )}

              {/* CTAs */}
              <div className="flex flex-wrap gap-2 sm:gap-3">
                {isUpcoming ? (
                  /* ── Upcoming: trailer as primary, no Watch EP 1 ── */
                  <>
                    {hasYouTubeTrailer && (
                      <a href={`https://youtube.com/watch?v=${anime.trailer!.id}`} target="_blank" rel="noopener noreferrer">
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          className="flex items-center gap-2 sm:gap-3 bg-white text-black px-5 sm:px-8 py-3 sm:py-3.5 font-bold text-xs sm:text-sm uppercase tracking-widest hover:bg-white/90 transition-colors"
                        >
                          <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-black" />
                          Watch Trailer
                        </motion.button>
                      </a>
                    )}
                    <div className="flex items-center gap-2 border border-white/10 px-4 sm:px-6 py-3 sm:py-3.5 text-xs font-mono uppercase tracking-widest text-white/35">
                      <span className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />
                      Not yet released
                    </div>
                  </>
                ) : (
                  /* ── Released: Watch EP 1 + optional Trailer ── */
                  <>
                    <Link href={`/watch/al/${anime.id}/1`}>
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        className="flex items-center gap-2 sm:gap-3 bg-white text-black px-5 sm:px-8 py-3 sm:py-3.5 font-bold text-xs sm:text-sm uppercase tracking-widest hover:bg-white/90 transition-colors"
                      >
                        <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-black" />
                        Watch EP 1
                      </motion.button>
                    </Link>

                    {anime.trailer?.site === "youtube" && (
                      <a href={`https://youtube.com/watch?v=${anime.trailer.id}`} target="_blank" rel="noopener noreferrer">
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          className="flex items-center gap-2 border border-white/20 text-white px-4 sm:px-6 py-3 sm:py-3.5 text-xs sm:text-sm font-medium uppercase tracking-widest hover:bg-white/5 transition-colors"
                        >
                          Trailer
                        </motion.button>
                      </a>
                    )}
                  </>
                )}

                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => toggle(anilistId)}
                  className={`flex items-center gap-2 border px-4 sm:px-6 py-3 sm:py-3.5 text-xs sm:text-sm font-bold uppercase tracking-widest transition-all ${
                    saved ? "border-white bg-white text-black" : "border-white/20 text-white hover:border-white/50"
                  }`}
                >
                  {saved ? <BookmarkCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Bookmark className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                  {saved ? "In My List" : "Add to List"}
                </motion.button>
              </div>
            </motion.div>
          </div>
        </div>

        {/* Mobile extras */}
        <div className="sm:hidden mt-6 space-y-4">
          {description && (
            <p className="text-white/70 text-sm leading-relaxed">{description.length > 400 ? description.slice(0, 400) + "…" : description}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {anime.genres.map((g) => (
              <Link key={g} href={`/browse?genre=${encodeURIComponent(g)}`}>
                <span className="text-[10px] font-mono uppercase tracking-widest border border-white/10 px-2.5 py-1 text-white/50">{g}</span>
              </Link>
            ))}
          </div>
          {(studio || anime.episodes) && (
            <p className="text-white/30 text-[10px] font-mono uppercase tracking-widest">
              {studio && `Studio: ${studio}`}{studio && anime.episodes ? " · " : ""}{anime.episodes && `${anime.episodes} episodes`}
            </p>
          )}
        </div>

        {/* Characters */}
        {characterEdges.length > 0 && (
          <div className="mt-12 sm:mt-20">
            <h2 className="font-serif text-2xl sm:text-3xl text-white mb-5 sm:mb-8">Characters</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4">
              {characterEdges.map((edge, i) => {
                const char = edge.node;
                const va = edge.voiceActors?.[0];
                const charImg = char.image?.large || char.image?.medium || "";
                const vaImg = va?.image?.large || va?.image?.medium || "";
                return (
                  <motion.div
                    key={char.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <Link href={`/character/${char.id}`}>
                      <div className="group cursor-pointer">
                        {/* Character portrait */}
                        <div className="relative aspect-[2/3] overflow-hidden border border-white/8 bg-zinc-900 mb-2">
                          {charImg ? (
                            <img
                              src={charImg}
                              alt={char.name.full}
                              className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <span className="text-white/10 font-serif text-3xl">{char.name.full[0]}</span>
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
                          {/* VA thumbnail overlay bottom-right */}
                          {vaImg && (
                            <div className="absolute bottom-1.5 right-1.5 w-7 h-7 sm:w-9 sm:h-9 border border-white/20 overflow-hidden bg-zinc-900">
                              <img src={vaImg} alt={va?.name.full} className="w-full h-full object-cover object-top" />
                            </div>
                          )}
                        </div>
                        {/* Character name */}
                        <p className="text-white/80 text-[11px] sm:text-xs font-medium line-clamp-1 leading-snug group-hover:text-white transition-colors">
                          {char.name.full}
                        </p>
                        {/* Voice actor name */}
                        {va && (
                          <p className="text-white/30 text-[9px] font-mono line-clamp-1 mt-0.5">
                            {va.name.full}
                          </p>
                        )}
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {/* Reviews Section */}
        <div className="mt-12 sm:mt-20">

          {/* Rating gauge */}
          {reviewSummary && reviewSummary.total > 0 && (
            <div className="pb-8 border-b border-white/5 mb-6">
              <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white/20 mb-4">Nexa Meter — Series Rating</p>
              <SeriesRatingGauge summary={reviewSummary} />
            </div>
          )}

          {/* Section header + sort controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <h2 className="text-xl font-bold text-white">
              Reviews
              {reviewSummary && reviewSummary.total > 0 && (
                <span className="text-white/30 font-normal text-base ml-2">{reviewSummary.total}</span>
              )}
            </h2>
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)}
                className="bg-zinc-900 border border-white/10 text-white/70 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-white/30 cursor-pointer"
              >
                <option value="liked">Most Liked</option>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </select>
              <label className="flex items-center gap-2 cursor-pointer select-none group">
                <div
                  onClick={() => setShowSpoilers((v) => !v)}
                  className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                    showSpoilers ? "bg-amber-500/80 border-amber-400" : "border-white/20 bg-transparent group-hover:border-white/40"
                  }`}
                >
                  {showSpoilers && (
                    <svg className="w-2.5 h-2.5 text-black" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span className="text-xs text-white/50 group-hover:text-white/70 transition-colors">Show Spoilers</span>
              </label>
            </div>
          </div>

          {/* Compose box — Moctale style */}
          <div className="bg-zinc-900 rounded-xl p-4 mb-4">
            {/* Row: avatar + username + rating pills */}
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-zinc-700 flex items-center justify-center text-sm font-bold text-white/80 flex-shrink-0 uppercase select-none">
                {authUser
                  ? authUser.displayName.split(" ").map(w => w[0]).join("").slice(0, 2)
                  : (username.trim() || "G").slice(0, 2)}
              </div>
              {authUser ? (
                <span className="text-sm text-white/60">@{authUser.username}</span>
              ) : (
                <input
                  type="text"
                  placeholder="@username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none w-28 min-w-0"
                />
              )}
              <div className="flex items-center gap-1 ml-auto flex-wrap justify-end">
                {RATING_OPTIONS.map((opt) => {
                  const active = selectedRating === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleRatingSelect(opt.value)}
                      className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${
                        active
                          ? "bg-zinc-600 text-white"
                          : "text-white/40 hover:text-white/70"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Textarea */}
            <textarea
              ref={textRef}
              placeholder="Write your review here..."
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              maxLength={1000}
              rows={3}
              className="w-full bg-transparent text-white/80 text-sm placeholder:text-white/25 focus:outline-none resize-none pb-2"
            />

            {/* Divider + footer */}
            <div className="border-t border-white/8 pt-3 flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none group">
                <div
                  onClick={() => setIsSpoiler((v) => !v)}
                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                    isSpoiler ? "bg-amber-500/80 border-amber-400" : "border-white/20 group-hover:border-white/40"
                  }`}
                >
                  {isSpoiler && (
                    <svg className="w-2 h-2 text-black" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span className="text-[11px] text-white/35 group-hover:text-white/55 transition-colors">Contains spoilers</span>
              </label>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-white/25">{reviewText.length}/1000</span>
                <button
                  onClick={handleSubmit}
                  disabled={!selectedRating || reviewText.trim().length === 0 || submitting}
                  className={`px-5 py-1.5 rounded-full text-sm font-medium transition-all ${
                    selectedRating && reviewText.trim().length > 0 && !submitting
                      ? "bg-zinc-600 text-white hover:bg-zinc-500"
                      : "bg-zinc-700/50 text-white/25 cursor-not-allowed"
                  }`}
                >
                  {submitting ? "Posting..." : "Post"}
                </button>
              </div>
            </div>
          </div>

          {/* Review list — blurred teaser */}
          {reviewsLoading ? (
            <div className="space-y-3 mt-3">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="bg-zinc-900 rounded-xl p-4 h-24 animate-pulse" />
              ))}
            </div>
          ) : !reviews || reviews.length === 0 ? (
            <p className="text-white/20 text-sm text-center py-10">No reviews yet. Be the first!</p>
          ) : (
            <div className="relative mt-3">
              <div className="space-y-3 blur-sm pointer-events-none select-none">
                {reviews.slice(0, 2).map((review) => {
                  const cfg = getRatingConfig(review.rating as RatingOption);
                  return (
                    <div key={review.id} className="bg-zinc-900 rounded-xl p-4">
                      <div className="flex items-start gap-3">
                        <img src={review.avatarUrl} alt="" className="w-10 h-10 rounded-full flex-shrink-0 bg-zinc-800" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div>
                              <span className="text-sm font-semibold text-white">{review.username}</span>
                              <span className="block text-[11px] text-white/35 mt-0.5">{timeAgo(review.createdAt)}</span>
                            </div>
                            <span className={`text-xs font-medium px-3 py-1 rounded-full ${cfg.bg} ${cfg.border} ${cfg.color} border`}>{cfg.label}</span>
                          </div>
                          <p className="text-white/60 text-sm leading-relaxed mt-1 line-clamp-2">{review.content}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-transparent rounded-xl flex items-end justify-center pb-5">
                <button
                  onClick={() => setShowReviewsModal(true)}
                  className="flex items-center gap-2 bg-white/10 hover:bg-white/15 border border-white/20 text-white text-sm font-medium px-6 py-2.5 rounded-full backdrop-blur-sm transition-all"
                >
                  <MessageCircle className="w-4 h-4" />
                  Show Reviews ({reviews.length})
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Recommendations */}
        {recs.length > 0 && (
          <div className="mt-12 sm:mt-16">
            <h2 className="font-serif text-2xl sm:text-3xl text-white mb-5 sm:mb-8">You Might Also Like</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 sm:gap-4">
              {recs.map((rec, i) => {
                if (!rec) return null;
                const recTitle = rec.title.english || rec.title.romaji;
                const recCover = rec.coverImage?.large || "";
                const recScore = rec.averageScore ? (rec.averageScore / 10).toFixed(1) : null;
                return (
                  <motion.div
                    key={rec.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                  >
                    <Link href={`/anime/al/${rec.id}`}>
                      <div className="group cursor-pointer">
                        <div className="relative aspect-[2/3] overflow-hidden border border-white/5 mb-2">
                          <img
                            src={recCover}
                            alt={recTitle}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                            loading="lazy"
                          />
                          {recScore && (
                            <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 bg-black/70 text-white text-[9px] font-mono px-1.5 py-0.5">
                              <Star className="w-2.5 h-2.5" />{recScore}
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <p className="text-white/70 text-[11px] font-medium line-clamp-2 leading-snug group-hover:text-white transition-colors">
                          {recTitle}
                        </p>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {/* Streaming platforms */}
        {(anime.externalLinks ?? []).filter(l => l.type === "STREAMING").length > 1 && (
          <div className="mt-10 pt-8 border-t border-white/5">
            <p className="text-[9px] font-mono text-white/25 uppercase tracking-[0.3em] mb-3">Available on</p>
            <div className="flex flex-wrap gap-2">
              {(anime.externalLinks ?? []).filter(l => l.type === "STREAMING").map((l) => (
                <a
                  key={l.url ?? l.site}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-mono uppercase tracking-widest border border-white/10 text-white/40 hover:border-white/30 hover:text-white px-3 py-1.5 transition-colors"
                >
                  {l.site}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>

    {/* Reviews Modal */}
    <AnimatePresence>
      {showReviewsModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setShowReviewsModal(false); }}
        >
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            className="bg-zinc-950 border border-white/10 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[88vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 flex-shrink-0">
              <h3 className="font-bold text-white text-lg">
                Reviews
                {reviews && reviews.length > 0 && (
                  <span className="text-white/30 font-normal text-sm ml-2">{reviews.length}</span>
                )}
              </h3>
              <div className="flex items-center gap-3">
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)}
                  className="bg-zinc-900 border border-white/10 text-white/70 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-white/30 cursor-pointer"
                >
                  <option value="liked">Most Liked</option>
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                </select>
                <label className="flex items-center gap-1.5 cursor-pointer select-none group">
                  <div
                    onClick={() => setShowSpoilers((v) => !v)}
                    className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                      showSpoilers ? "bg-amber-500/80 border-amber-400" : "border-white/20 bg-transparent group-hover:border-white/40"
                    }`}
                  >
                    {showSpoilers && (
                      <svg className="w-2.5 h-2.5 text-black" viewBox="0 0 10 10" fill="none">
                        <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span className="text-xs text-white/40">Spoilers</span>
                </label>
                <button
                  onClick={() => setShowReviewsModal(false)}
                  className="text-white/40 hover:text-white transition-colors p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable review list */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
              {reviews && [...reviews]
                .sort((a, b) => {
                  if (sortOrder === "liked") return b.likes - a.likes;
                  if (sortOrder === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                })
                .map((review) => {
                  const cfg = getRatingConfig(review.rating as RatingOption);
                  const liked = likedIds.has(review.id);
                  const isSpoilerReview = review.spoiler;
                  const revealed = showSpoilers || revealedIds.has(review.id);
                  return (
                    <motion.div
                      key={review.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-zinc-900 rounded-xl p-4"
                    >
                      <div className="flex items-start gap-3">
                        <img src={review.avatarUrl} alt={review.username} className="w-10 h-10 rounded-full flex-shrink-0 bg-zinc-800" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div>
                              <span className="text-sm font-semibold text-white">{review.username}</span>
                              <span className="block text-[11px] text-white/35 mt-0.5">{timeAgo(review.createdAt)}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {isSpoilerReview && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-400/30 text-amber-400/70 bg-amber-400/10">spoiler</span>
                              )}
                              <span className={`text-xs font-medium px-3 py-1 rounded-full ${cfg.bg} ${cfg.border} ${cfg.color} border`}>{cfg.label}</span>
                            </div>
                          </div>
                          {isSpoilerReview && !revealed ? (
                            <div className="relative mt-1">
                              <p className="text-white/60 text-sm leading-relaxed blur-sm select-none pointer-events-none">{review.content}</p>
                              <button
                                onClick={() => setRevealedIds((prev) => new Set(prev).add(review.id))}
                                className="absolute inset-0 flex items-center justify-center text-[11px] text-amber-400/80 hover:text-amber-400 transition-colors"
                              >
                                Click to reveal spoiler
                              </button>
                            </div>
                          ) : (
                            <p className="text-white/60 text-sm leading-relaxed mt-1">{review.content}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={() => handleLike(review.id)}
                          disabled={liked}
                          className={`flex items-center gap-1.5 text-xs rounded-full px-3 py-1 border transition-colors ${
                            liked ? "border-white/15 text-white/35 cursor-default" : "border-white/10 text-white/40 hover:border-white/25 hover:text-white/60"
                          }`}
                        >
                          <ThumbsUp className="w-3 h-3" />{review.likes}
                        </button>
                        <button
                          onClick={() => toggleReplies(review.id)}
                          className="flex items-center gap-1.5 text-xs rounded-full px-3 py-1 border border-white/10 text-white/40 hover:border-white/25 hover:text-white/60 transition-colors"
                        >
                          <MessageCircle className="w-3 h-3" />
                          {expandedReplies.has(review.id) ? "Hide" : "Reply"}
                        </button>
                      </div>
                      <AnimatePresence>
                        {expandedReplies.has(review.id) && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.18 }}
                            className="mt-3 pl-3 border-l border-white/8 space-y-3 overflow-hidden"
                          >
                            {(repliesData[review.id] || []).map(reply => (
                              <div key={reply.id} className="flex items-start gap-2">
                                <img src={reply.avatarUrl} alt={reply.username} className="w-6 h-6 rounded-full flex-shrink-0 bg-zinc-800" />
                                <div>
                                  <span className="text-xs font-semibold text-white/70">{reply.username}</span>
                                  <span className="text-[10px] text-white/30 ml-2">{timeAgo(reply.createdAt)}</span>
                                  <p className="text-xs text-white/55 leading-relaxed mt-0.5">{reply.content}</p>
                                </div>
                              </div>
                            ))}
                            <div className="flex items-center gap-2 pt-1">
                              <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] font-bold text-white/60 uppercase flex-shrink-0 select-none">
                                {authUser ? authUser.displayName[0].toUpperCase() : "G"}
                              </div>
                              <input
                                type="text"
                                placeholder="Write a reply..."
                                value={replyText[review.id] || ""}
                                onChange={e => setReplyText(prev => ({ ...prev, [review.id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitReply(review.id); } }}
                                className="flex-1 bg-zinc-800 rounded-full px-3 py-1.5 text-xs text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-white/20"
                              />
                              <button
                                onClick={() => submitReply(review.id)}
                                disabled={replySubmitting.has(review.id) || !(replyText[review.id] || "").trim()}
                                className="text-white/40 hover:text-white/70 transition-colors disabled:opacity-30"
                              >
                                <Send className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}

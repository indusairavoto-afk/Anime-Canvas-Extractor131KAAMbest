import { motion, AnimatePresence } from "framer-motion";
import { Link, useParams } from "wouter";
import { useState, useRef } from "react";
import { SeriesRatingGauge } from "@/components/SeriesRatingGauge";
import { Play, Star, Calendar, Tv, ArrowLeft, Clock, Bookmark, BookmarkCheck, CheckCircle2, Heart, ThumbsUp, MessageCircle, X } from "lucide-react";
import {
  useGetAnime,
  getGetAnimeQueryKey,
  useListEpisodes,
  getListEpisodesQueryKey,
  useListAnimeReviews,
  getListAnimeReviewsQueryKey,
  useCreateAnimeReview,
  useGetAnimeReviewSummary,
  getGetAnimeReviewSummaryQueryKey,
  useLikeReview,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useWatchProgress } from "@/hooks/useWatchProgress";

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } };

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


function ReviewCard({ review, onLike, likedIds }: {
  review: { id: number; username: string; avatarUrl: string; rating: RatingOption; content: string; likes: number; createdAt: string };
  onLike: (id: number) => void;
  likedIds: Set<number>;
}) {
  const cfg = getRatingConfig(review.rating);
  const liked = likedIds.has(review.id);
  return (
    <motion.div variants={fadeUp} className="border border-white/5 p-4 sm:p-5 space-y-3 hover:border-white/10 transition-colors">
      <div className="flex items-start gap-3">
        <img src={review.avatarUrl} alt={review.username} className="w-9 h-9 rounded-full flex-shrink-0 bg-white/5" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-sm font-medium text-white">@{review.username}</span>
            <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full border ${cfg.color} ${cfg.bg} ${cfg.border} flex items-center gap-1`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              {cfg.label}
            </span>
            <span className="text-[10px] font-mono text-white/30 ml-auto">{timeAgo(review.createdAt)}</span>
          </div>
          <p className="text-white/70 text-sm leading-relaxed">{review.content}</p>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          onClick={() => onLike(review.id)}
          disabled={liked}
          className={`flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest transition-colors px-3 py-1.5 border ${
            liked
              ? "border-white/20 text-white/40 cursor-default"
              : "border-white/10 text-white/30 hover:border-white/30 hover:text-white/60"
          }`}
        >
          <ThumbsUp className="w-3 h-3" />
          {review.likes}
        </button>
      </div>
    </motion.div>
  );
}

export default function AnimeDetail() {
  const params = useParams();
  const id = parseInt(params.id ?? "0");
  const { toggle, isInList } = useWatchlist();
  const { isWatched, getLastWatched, countWatched } = useWatchProgress();
  const saved = isInList(id);
  const queryClient = useQueryClient();

  const [selectedRating, setSelectedRating] = useState<RatingOption | null>(null);
  const [reviewText, setReviewText] = useState("");
  const [username, setUsername] = useState("");
  const [likedIds, setLikedIds] = useState<Set<number>>(new Set());
  const [showReviewsModal, setShowReviewsModal] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const { data: anime, isLoading } = useGetAnime(id, {
    query: { enabled: !!id, queryKey: getGetAnimeQueryKey(id) },
  });
  const { data: episodes, isLoading: epsLoading } = useListEpisodes(id, {
    query: { enabled: !!id, queryKey: getListEpisodesQueryKey(id) },
  });
  const { data: reviews, isLoading: reviewsLoading } = useListAnimeReviews(id, {
    query: { enabled: !!id, queryKey: getListAnimeReviewsQueryKey(id) },
  });
  const { data: reviewSummary } = useGetAnimeReviewSummary(id, {
    query: { enabled: !!id, queryKey: getGetAnimeReviewSummaryQueryKey(id) },
  });
  const { mutate: createReview, isPending: submitting } = useCreateAnimeReview({
    mutation: {
      onSuccess: () => {
        setReviewText("");
        setSelectedRating(null);
        queryClient.invalidateQueries({ queryKey: getListAnimeReviewsQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetAnimeReviewSummaryQueryKey(id) });
      },
    },
  });
  const { mutate: likeReviewMutation } = useLikeReview({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAnimeReviewsQueryKey(id) });
      },
    },
  });

  function handleRatingSelect(r: RatingOption) {
    setSelectedRating(r);
    setTimeout(() => textRef.current?.focus(), 50);
  }

  function handleSubmit() {
    if (!selectedRating || reviewText.trim().length === 0) return;
    const name = username.trim() || "Guest";
    createReview({ id, data: { username: name, rating: selectedRating, content: reviewText.trim() } });
  }

  function handleLike(reviewId: number) {
    if (likedIds.has(reviewId)) return;
    setLikedIds((prev) => new Set(prev).add(reviewId));
    likeReviewMutation({ id: reviewId });
  }

  if (isLoading) {
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

  if (!anime) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-white/40 font-mono">Anime not found</p>
      </div>
    );
  }

  const lastEpisodeId = getLastWatched(id);
  const watchedCount = episodes ? countWatched(episodes.map((e) => e.id)) : 0;
  const continueEp = episodes?.find((e) => e.id === lastEpisodeId);
  const firstEpisode = episodes?.[0];
  const resumeEp = continueEp ?? firstEpisode;
  const canPost = selectedRating !== null && reviewText.trim().length > 0;

  return (
    <>
    <div className="bg-black text-white min-h-screen">
      <div className="relative h-[40vh] sm:h-[55vh] overflow-hidden">
        <img
          src={anime.bannerImage}
          alt={anime.title}
          className="w-full h-full object-cover"
          style={{ filter: "brightness(0.35) contrast(1.1)" }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent" />
        <div className="absolute top-4 sm:top-6 left-4 sm:left-8 lg:left-16">
          <Link href="/browse" className="flex items-center gap-2 text-white/50 hover:text-white text-xs sm:text-sm font-mono uppercase tracking-widest transition-colors" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" /> Browse
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-16 -mt-36 sm:-mt-48 relative z-10 pb-16 sm:pb-24">
        <div className="flex gap-4 sm:gap-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6 }}
            className="flex-shrink-0 w-28 sm:w-48"
          >
            <div className="aspect-[2/3] border border-white/10 overflow-hidden shadow-2xl">
              <img src={anime.coverImage} alt={anime.title} className="w-full h-full object-cover" />
            </div>
          </motion.div>

          <div className="flex-1 pt-20 sm:pt-28 min-w-0">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              {anime.japaneseTitle && (
                <p className="hidden sm:block text-white/30 font-mono text-xs tracking-widest uppercase mb-2">{anime.japaneseTitle}</p>
              )}
              <h1 className="font-serif text-3xl sm:text-5xl lg:text-6xl text-white leading-tight mb-3 sm:mb-4">{anime.title}</h1>
              <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-4 sm:mb-6 text-xs font-mono text-white/50 uppercase tracking-widest">
                <span className="flex items-center gap-1.5"><Star className="w-3 h-3" />{anime.rating.toFixed(1)}</span>
                <span className="flex items-center gap-1.5"><Calendar className="w-3 h-3" />{anime.releaseYear}</span>
                <span className="hidden sm:flex items-center gap-1.5"><Tv className="w-3 h-3" />{anime.totalEpisodes} eps</span>
                <span className={`px-2 py-0.5 border text-[9px] ${anime.status === "ongoing" ? "border-white/30 text-white" : "border-white/10 text-white/40"}`}>{anime.status}</span>
                <span className="px-2 py-0.5 border border-white/10 text-[9px]">{anime.type}</span>
                {watchedCount > 0 && (
                  <span className="hidden sm:flex items-center gap-1.5 text-white/50">
                    <CheckCircle2 className="w-3 h-3" />{watchedCount}/{episodes?.length ?? anime.totalEpisodes} watched
                  </span>
                )}
              </div>
              <div className="hidden sm:flex flex-wrap gap-2 mb-6">
                {anime.genre.map((g) => (
                  <Link key={g} href={`/browse?genre=${encodeURIComponent(g)}`}>
                    <span className="text-[10px] font-mono uppercase tracking-widest border border-white/10 px-3 py-1 text-white/50 hover:border-white/30 hover:text-white transition-colors cursor-pointer">{g}</span>
                  </Link>
                ))}
              </div>
              <p className="hidden sm:block text-white/70 leading-relaxed max-w-2xl mb-4 sm:mb-8">{anime.description}</p>
              <p className="hidden sm:block text-white/30 text-xs font-mono uppercase tracking-widest mb-6 sm:mb-8">Studio: {anime.studio}</p>
              <div className="flex flex-wrap gap-2 sm:gap-3">
                {resumeEp && (
                  <Link href={`/watch/${resumeEp.id}`}>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      className="flex items-center gap-2 sm:gap-3 bg-white text-black px-5 sm:px-8 py-3 sm:py-3.5 font-bold text-xs sm:text-sm uppercase tracking-widest hover:bg-white/90 transition-colors"
                      data-testid="button-watch-first"
                    >
                      <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-black" />
                      {continueEp ? `Continue EP ${continueEp.episodeNumber}` : "Watch EP 1"}
                    </motion.button>
                  </Link>
                )}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => toggle(id)}
                  className={`flex items-center gap-2 border px-4 sm:px-6 py-3 sm:py-3.5 text-xs sm:text-sm font-bold uppercase tracking-widest transition-all ${
                    saved ? "border-white bg-white text-black" : "border-white/20 text-white hover:border-white/50"
                  }`}
                  data-testid="button-bookmark"
                >
                  {saved ? <BookmarkCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Bookmark className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                  {saved ? "In My List" : "Add to List"}
                </motion.button>
              </div>
            </motion.div>
          </div>
        </div>

        <div className="sm:hidden mt-6 space-y-4">
          <p className="text-white/70 text-sm leading-relaxed">{anime.description}</p>
          <div className="flex flex-wrap gap-1.5">
            {anime.genre.map((g) => (
              <Link key={g} href={`/browse?genre=${encodeURIComponent(g)}`}>
                <span className="text-[10px] font-mono uppercase tracking-widest border border-white/10 px-2.5 py-1 text-white/50">{g}</span>
              </Link>
            ))}
          </div>
          <p className="text-white/30 text-[10px] font-mono uppercase tracking-widest">Studio: {anime.studio} · {anime.totalEpisodes} episodes</p>
          {watchedCount > 0 && (
            <p className="text-white/40 text-[10px] font-mono uppercase tracking-widest flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> {watchedCount}/{episodes?.length ?? anime.totalEpisodes} episodes watched
            </p>
          )}
        </div>

        {!epsLoading && episodes && episodes.length > 0 && (
          <div className="mt-12 sm:mt-20">
            <div className="flex items-center gap-3 mb-5 sm:mb-8">
              <h2 className="font-serif text-2xl sm:text-3xl text-white">Episodes</h2>
              <span className="text-white/30 font-mono text-sm">{episodes.length}</span>
              {watchedCount > 0 && (
                <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest border border-white/10 px-2 py-0.5 ml-1">
                  {watchedCount} watched
                </span>
              )}
            </div>
            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              className="space-y-1.5 sm:space-y-2"
            >
              {episodes.map((ep) => {
                const watched = isWatched(ep.id);
                return (
                  <motion.div key={ep.id} variants={fadeUp}>
                    <Link href={`/watch/${ep.id}`}>
                      <div
                        className={`group flex items-center gap-3 sm:gap-4 border p-3 sm:p-4 hover:border-white/20 hover:bg-white/[0.02] transition-all cursor-pointer ${watched ? "border-white/10 bg-white/[0.02]" : "border-white/5"}`}
                        data-testid={`row-episode-${ep.id}`}
                      >
                        <div className="relative flex-shrink-0 w-20 sm:w-28 overflow-hidden">
                          <img src={ep.thumbnailUrl} alt={ep.title} className="w-full aspect-video object-cover transition-all duration-500" />
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                            <Play className="w-4 h-4 sm:w-5 sm:h-5 text-white fill-white" />
                          </div>
                          {watched && (
                            <div className="absolute bottom-1 right-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-white drop-shadow" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 sm:mb-1">
                            <span className={`text-[10px] font-mono uppercase tracking-widest ${watched ? "text-white/50" : "text-white/30"}`}>EP {ep.episodeNumber}</span>
                            <span className="text-[9px] font-mono uppercase tracking-widest border border-white/10 px-1.5 py-0.5 text-white/30">{ep.type}</span>
                            {watched && <span className="hidden sm:inline text-[9px] font-mono text-white/40 uppercase tracking-widest">Watched</span>}
                          </div>
                          <h3 className={`font-medium text-sm sm:text-base group-hover:text-white transition-colors ${watched ? "text-white/60" : "text-white"}`}>{ep.title}</h3>
                          {ep.description && <p className="hidden sm:block text-white/40 text-xs mt-1 line-clamp-1">{ep.description}</p>}
                        </div>
                        <div className="text-right flex-shrink-0 hidden sm:block">
                          <div className="flex items-center gap-1.5 text-white/30 text-xs font-mono">
                            <Clock className="w-3 h-3" />{ep.duration}m
                          </div>
                          <p className="text-white/20 text-[10px] font-mono mt-1">{ep.releaseDate}</p>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        )}

        {/* Reviews Section */}
        <div className="mt-12 sm:mt-20">
          <div className="flex items-center gap-3 mb-6 sm:mb-8">
            <h2 className="font-serif text-2xl sm:text-3xl text-white">Reviews</h2>
            {reviewSummary && reviewSummary.total > 0 && (
              <span className="text-white/30 font-mono text-sm">{reviewSummary.total}</span>
            )}
          </div>

          {/* Rating gauge */}
          {reviewSummary && reviewSummary.total > 0 && (
            <div className="pb-8 border-b border-white/5 mb-6">
              <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white/20 mb-4">Nexa Meter — Series Rating</p>
              <SeriesRatingGauge summary={reviewSummary} />
            </div>
          )}

          {/* Review compose box */}
          <div className="mt-6 border border-white/10 p-4 sm:p-6 space-y-4">
            {/* Step 1: select a rating */}
            <div>
              <p className="text-xs font-mono uppercase tracking-widest text-white/30 mb-3">
                {selectedRating ? "Your rating" : "Select a rating to continue"}
              </p>
              <div className="flex flex-wrap gap-2">
                {RATING_OPTIONS.map((opt) => {
                  const active = selectedRating === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleRatingSelect(opt.value)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                        active
                          ? `${opt.bg} ${opt.border} ${opt.color}`
                          : "border-white/10 text-white/40 hover:border-white/20 hover:text-white/60"
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${opt.dot} ${active ? "opacity-100" : "opacity-40"}`} />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2: write review (only after rating is selected) */}
            <AnimatePresence>
              {selectedRating && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-3"
                >
                  <input
                    type="text"
                    placeholder="Your name (optional)"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-transparent border border-white/10 text-white text-sm px-4 py-2.5 placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                  />
                  <textarea
                    ref={textRef}
                    placeholder="Write your review here..."
                    value={reviewText}
                    onChange={(e) => setReviewText(e.target.value)}
                    maxLength={1000}
                    rows={4}
                    className="w-full bg-transparent border border-white/10 text-white text-sm px-4 py-3 placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors resize-none"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-white/20">{reviewText.length}/1000</span>
                    <button
                      onClick={handleSubmit}
                      disabled={!canPost || submitting}
                      className={`px-6 py-2.5 text-xs font-bold uppercase tracking-widest transition-all ${
                        canPost && !submitting
                          ? "bg-white text-black hover:bg-white/90"
                          : "bg-white/10 text-white/30 cursor-not-allowed"
                      }`}
                    >
                      {submitting ? "Posting..." : "Post"}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Review list — blurred teaser */}
          {reviewsLoading ? (
            <div className="mt-6 space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="border border-white/5 p-4 h-24 animate-pulse bg-white/[0.01]" />
              ))}
            </div>
          ) : reviews && reviews.length > 0 ? (
            <div className="relative mt-4">
              <div className="space-y-2 blur-sm pointer-events-none select-none">
                {reviews.slice(0, 2).map((review) => (
                  <ReviewCard
                    key={review.id}
                    review={review as any}
                    onLike={handleLike}
                    likedIds={likedIds}
                  />
                ))}
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-transparent flex items-end justify-center pb-5">
                <button
                  onClick={() => setShowReviewsModal(true)}
                  className="flex items-center gap-2 bg-white/10 hover:bg-white/15 border border-white/20 text-white text-sm font-medium px-6 py-2.5 rounded-full backdrop-blur-sm transition-all"
                >
                  <MessageCircle className="w-4 h-4" />
                  Show Reviews ({reviews.length})
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-6 text-white/20 text-sm font-mono text-center py-8">No reviews yet. Be the first!</p>
          )}
        </div>
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
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 flex-shrink-0">
              <h3 className="font-bold text-white text-lg">
                Reviews
                {reviews && reviews.length > 0 && (
                  <span className="text-white/30 font-normal text-sm ml-2">{reviews.length}</span>
                )}
              </h3>
              <button
                onClick={() => setShowReviewsModal(false)}
                className="text-white/40 hover:text-white transition-colors p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-2">
              {reviews && reviews.map((review) => (
                <ReviewCard
                  key={review.id}
                  review={review as any}
                  onLike={handleLike}
                  likedIds={likedIds}
                />
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}

import { useState, useEffect } from "react";
import { useParams, Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Calendar, Users, Edit3, LogOut, ThumbsUp, MessageCircle } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";

interface UserProfile {
  id: number;
  username: string;
  displayName: string;
  email: string;
  bio: string | null;
  avatarUrl: string;
  createdAt: string;
  reviewCount: number;
}

interface ReviewItem {
  id: number;
  animeId: number;
  username: string;
  avatarUrl: string;
  rating: string;
  content: string;
  spoiler: boolean;
  likes: number;
  createdAt: string;
}

const RATING_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
  skip:        { label: "Skip",       color: "text-red-400",    bg: "bg-red-400/10",    border: "border-red-400/30",    dot: "bg-red-400" },
  timepass:    { label: "Timepass",   color: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/30", dot: "bg-yellow-400" },
  go_for_it:   { label: "Go for it",  color: "text-green-400",  bg: "bg-green-400/10",  border: "border-green-400/30",  dot: "bg-green-400" },
  perfection:  { label: "Perfection", color: "text-purple-400", bg: "bg-purple-400/10", border: "border-purple-400/30", dot: "bg-purple-400" },
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo > 1 ? "s" : ""} ago`;
  return `${Math.floor(mo / 12)} year${Math.floor(mo / 12) > 1 ? "s" : ""} ago`;
}

function joinedWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

type RatingFilter = "all" | "skip" | "timepass" | "go_for_it" | "perfection";

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { user: authUser, logout } = useAuth();
  const [, navigate] = useLocation();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [profileLoading, setProfileLoading] = useState(true);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [revealedIds, setRevealedIds] = useState<Set<number>>(new Set());

  const isOwn = authUser?.username === username;

  useEffect(() => {
    if (!username) return;
    setProfileLoading(true);
    setNotFound(false);
    fetch(`/api/users/${username}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => setProfile(data))
      .catch(code => { if (code === 404) setNotFound(true); })
      .finally(() => setProfileLoading(false));

    setReviewsLoading(true);
    fetch(`/api/users/${username}/reviews`)
      .then(r => r.ok ? r.json() : [])
      .then(setReviews)
      .finally(() => setReviewsLoading(false));
  }, [username]);

  const filteredReviews = ratingFilter === "all"
    ? reviews
    : reviews.filter(r => r.rating === ratingFilter);

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" />
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4">
        <p className="text-white/40 font-mono text-sm">User not found</p>
        <Link href="/">
          <button className="text-[10px] font-mono uppercase tracking-widest border border-white/10 text-white/40 hover:text-white px-4 py-2 transition-colors">
            Go home
          </button>
        </Link>
      </div>
    );
  }

  const initials = profile.displayName.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-6">

          {/* ── Left: Profile card ── */}
          <div className="lg:w-64 flex-shrink-0">
            <div className="bg-zinc-900 rounded-2xl p-6 flex flex-col items-center text-center sticky top-20">
              {/* Avatar */}
              <div className="w-24 h-24 rounded-full bg-zinc-700 flex items-center justify-center text-2xl font-bold text-white/80 mb-4 select-none">
                {initials}
              </div>

              {/* Name + handle */}
              <h1 className="text-lg font-bold text-white">{profile.displayName}</h1>
              <p className="text-sm text-white/40 mt-0.5">@{profile.username}</p>

              {/* Bio */}
              {profile.bio && (
                <p className="text-sm text-white/50 mt-3 leading-relaxed">{profile.bio}</p>
              )}

              {/* Stats */}
              <div className="flex gap-6 mt-5 w-full justify-center">
                <div className="text-center">
                  <p className="text-xl font-bold text-white">{profile.reviewCount}</p>
                  <p className="text-[10px] text-white/35 uppercase tracking-widest font-mono mt-0.5">Reviews</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-white">0</p>
                  <p className="text-[10px] text-white/35 uppercase tracking-widest font-mono mt-0.5">Collections</p>
                </div>
              </div>

              {/* Followers row */}
              <div className="flex items-center gap-3 mt-4 text-xs text-white/40">
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" /> 0 Followers
                </span>
                <span>·</span>
                <span>0 Following</span>
              </div>

              {/* Joined */}
              <div className="flex items-center gap-1.5 mt-2 text-xs text-white/35">
                <Calendar className="w-3 h-3" />
                <span>Joined {joinedWhen(profile.createdAt)}</span>
              </div>

              {/* Actions */}
              <div className="mt-5 w-full space-y-2">
                {isOwn ? (
                  <>
                    <button className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm py-2.5 rounded-xl transition-colors font-medium">
                      <Edit3 className="w-3.5 h-3.5" />
                      Edit Profile
                    </button>
                    <button
                      onClick={() => { logout(); navigate("/"); }}
                      className="w-full flex items-center justify-center gap-2 border border-white/10 text-white/40 hover:text-red-400 hover:border-red-400/30 text-sm py-2.5 rounded-xl transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Sign Out
                    </button>
                  </>
                ) : (
                  <button className="w-full bg-white text-black text-sm py-2.5 rounded-xl font-semibold hover:bg-white/90 transition-colors">
                    Follow
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── Right: Reviews ── */}
          <div className="flex-1 min-w-0">
            {/* Tab bar */}
            <div className="flex border-b border-white/8 mb-5">
              <button className="flex items-center gap-2 pb-3 px-1 text-sm font-semibold text-white border-b-2 border-white -mb-px mr-6">
                <Edit3 className="w-3.5 h-3.5" /> Reviews
              </button>
            </div>

            {/* Rating filter pills */}
            <div className="flex flex-wrap gap-2 mb-5">
              {(["all", "skip", "timepass", "go_for_it", "perfection"] as RatingFilter[]).map(f => {
                const cfg = f !== "all" ? RATING_CONFIG[f] : null;
                const active = ratingFilter === f;
                return (
                  <button
                    key={f}
                    onClick={() => setRatingFilter(f)}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                      active
                        ? f === "all"
                          ? "bg-white text-black"
                          : `${cfg!.bg} ${cfg!.color} ${cfg!.border} border`
                        : "bg-zinc-900 text-white/40 hover:text-white/70"
                    }`}
                  >
                    {f === "all" ? "All" : cfg!.label}
                  </button>
                );
              })}
            </div>

            {/* Review list */}
            {reviewsLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="bg-zinc-900 rounded-xl h-28 animate-pulse" />
                ))}
              </div>
            ) : filteredReviews.length === 0 ? (
              <div className="bg-zinc-900 rounded-xl p-10 text-center">
                <p className="text-white/25 text-sm">
                  {ratingFilter === "all" ? "No reviews yet." : `No "${RATING_CONFIG[ratingFilter]?.label}" reviews.`}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredReviews.map((review) => {
                  const cfg = RATING_CONFIG[review.rating];
                  const revealed = revealedIds.has(review.id);
                  return (
                    <motion.div
                      key={review.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-zinc-900 rounded-xl p-4"
                    >
                      <div className="flex items-start gap-3">
                        {/* Anime ID badge as cover placeholder */}
                        <Link href={`/anime/al/${review.animeId}`}>
                          <div className="w-14 h-20 bg-zinc-800 rounded-lg flex-shrink-0 flex items-center justify-center text-white/20 text-xs font-mono hover:bg-zinc-700 transition-colors cursor-pointer">
                            #{review.animeId}
                          </div>
                        </Link>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <Link href={`/anime/al/${review.animeId}`}>
                                <p className="text-sm font-semibold text-white hover:text-white/70 transition-colors cursor-pointer truncate">
                                  Anime #{review.animeId}
                                </p>
                              </Link>
                              <p className="text-[11px] text-white/35 mt-0.5">{timeAgo(review.createdAt)}</p>
                            </div>
                            {cfg && (
                              <span className={`text-xs font-medium px-3 py-1 rounded-full border flex-shrink-0 ${cfg.bg} ${cfg.border} ${cfg.color}`}>
                                {cfg.label}
                              </span>
                            )}
                          </div>
                          {review.spoiler && !revealed ? (
                            <div className="relative mt-2">
                              <p className="text-white/50 text-sm leading-relaxed blur-sm select-none pointer-events-none">{review.content}</p>
                              <button
                                onClick={() => setRevealedIds(prev => new Set(prev).add(review.id))}
                                className="absolute inset-0 flex items-center justify-center text-[11px] text-amber-400/80 hover:text-amber-400 transition-colors"
                              >
                                Click to reveal spoiler
                              </button>
                            </div>
                          ) : (
                            <p className="text-white/55 text-sm leading-relaxed mt-2">{review.content}</p>
                          )}
                          <div className="flex items-center gap-3 mt-3">
                            <span className="flex items-center gap-1 text-xs text-white/30">
                              <ThumbsUp className="w-3 h-3" /> {review.likes}
                            </span>
                            {review.spoiler && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-400/30 text-amber-400/60 bg-amber-400/10">
                                spoiler
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

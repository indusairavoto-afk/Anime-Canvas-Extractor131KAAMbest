import { useState, useEffect, useRef } from "react";
import { apiUrl } from "@/lib/api";
import { useParams, Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Users, Edit3, LogOut, ThumbsUp, X, Check, Loader2, Clock, Play, Tv, Camera } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AvatarPickerModal } from "@/components/AvatarPickerModal";

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

interface HistoryEntry {
  id: number;
  animeId: number;
  episodeId: number;
  episodeNumber: number | null;
  animeTitle: string | null;
  coverImage: string | null;
  watchedAt: string;
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
type ProfileTab = "reviews" | "history";

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { user: authUser, logout, loginWithUser } = useAuth();
  const [, navigate] = useLocation();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [profileLoading, setProfileLoading] = useState(true);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [revealedIds, setRevealedIds] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<ProfileTab>("reviews");

  // Avatar picker
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

  // Edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const displayNameRef = useRef<HTMLInputElement>(null);

  const isOwn = authUser?.username === username;

  useEffect(() => {
    if (!username) return;
    setProfileLoading(true);
    setNotFound(false);
    fetch(apiUrl(`/api/users/${username}`))
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => setProfile(data))
      .catch(code => { if (code === 404) setNotFound(true); })
      .finally(() => setProfileLoading(false));

    setReviewsLoading(true);
    fetch(apiUrl(`/api/users/${username}/reviews`))
      .then(r => r.ok ? r.json() : [])
      .then(setReviews)
      .finally(() => setReviewsLoading(false));

    setHistoryLoading(true);
    fetch(apiUrl(`/api/history?username=${username}`))
      .then(r => r.ok ? r.json() : [])
      .then(setHistory)
      .finally(() => setHistoryLoading(false));
  }, [username]);

  function openEdit() {
    if (!profile) return;
    setEditDisplayName(profile.displayName);
    setEditBio(profile.bio ?? "");
    setEditError(null);
    setEditOpen(true);
    setTimeout(() => displayNameRef.current?.focus(), 50);
  }

  async function saveEdit() {
    if (!profile || !username) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(apiUrl(`/api/users/${username}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: editDisplayName, bio: editBio }),
      });
      const data = await res.json();
      if (!res.ok) { setEditError(data.error || "Failed to save"); return; }
      setProfile(data);
      setEditOpen(false);
    } catch {
      setEditError("Network error");
    } finally {
      setEditSaving(false);
    }
  }

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

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-6">

          {/* ── Left: Profile card ── */}
          <div className="lg:w-64 flex-shrink-0">
            <div className="bg-zinc-900 rounded-2xl p-6 flex flex-col items-center text-center sticky top-20">
              {/* Avatar */}
              <div className="relative mb-4 group">
                <img
                  src={profile.avatarUrl}
                  alt={profile.displayName}
                  className="w-24 h-24 rounded-full object-cover bg-zinc-700 border border-white/10"
                  style={profile.avatarUrl.includes("lorelei") ? { filter: "grayscale(1) contrast(1.1)" } : undefined}
                />
                {isOwn && (
                  <button
                    onClick={() => setAvatarPickerOpen(true)}
                    className="absolute inset-0 rounded-full flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Change avatar"
                  >
                    <Camera className="w-6 h-6 text-white" />
                  </button>
                )}
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
                  <p className="text-xl font-bold text-white">{historyLoading ? "—" : history.length}</p>
                  <p className="text-[10px] text-white/35 uppercase tracking-widest font-mono mt-0.5">Watched</p>
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
                    <button
                      onClick={openEdit}
                      className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm py-2.5 rounded-xl transition-colors font-medium">
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

          {/* ── Right: Content ── */}
          <div className="flex-1 min-w-0">
            {/* Tab bar */}
            <div className="flex border-b border-white/8 mb-5">
              <button
                onClick={() => setActiveTab("reviews")}
                className={`flex items-center gap-2 pb-3 px-1 text-sm font-semibold border-b-2 -mb-px mr-6 transition-colors ${activeTab === "reviews" ? "text-white border-white" : "text-white/40 border-transparent hover:text-white/70"}`}
              >
                <Edit3 className="w-3.5 h-3.5" /> Reviews
              </button>
              <button
                onClick={() => setActiveTab("history")}
                className={`flex items-center gap-2 pb-3 px-1 text-sm font-semibold border-b-2 -mb-px transition-colors ${activeTab === "history" ? "text-white border-white" : "text-white/40 border-transparent hover:text-white/70"}`}
              >
                <Clock className="w-3.5 h-3.5" /> History
                {history.length > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${activeTab === "history" ? "bg-white text-black" : "bg-white/10 text-white/40"}`}>
                    {history.length}
                  </span>
                )}
              </button>
            </div>

            {/* ── History tab ── */}
            <AnimatePresence mode="wait">
            {activeTab === "history" && (
              <motion.div key="history" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                {historyLoading ? (
                  <div className="space-y-3">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="bg-zinc-900 rounded-xl h-20 animate-pulse" />
                    ))}
                  </div>
                ) : history.length === 0 ? (
                  <div className="bg-zinc-900 rounded-xl p-12 text-center">
                    <Tv className="w-8 h-8 text-white/20 mx-auto mb-3" />
                    <p className="text-white/25 text-sm">No watch history yet.</p>
                    <p className="text-white/15 text-xs mt-1">Episodes watched for 10+ seconds appear here.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {history.map((entry) => (
                      <motion.div
                        key={entry.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-3 bg-zinc-900 rounded-xl p-3 hover:bg-zinc-800 transition-colors group"
                      >
                        {/* Cover */}
                        <div className="w-12 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-zinc-800">
                          {entry.coverImage
                            ? <img src={entry.coverImage} alt={entry.animeTitle ?? ""} className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-white/20"><Tv className="w-5 h-5" /></div>
                          }
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white truncate">
                            {entry.animeTitle ?? `Anime #${entry.animeId}`}
                          </p>
                          <p className="text-xs text-white/40 mt-0.5">
                            {entry.episodeNumber != null ? `Episode ${entry.episodeNumber}` : `Episode ID ${entry.episodeId}`}
                          </p>
                          <p className="text-[10px] text-white/25 mt-1 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" />
                            {timeAgo(entry.watchedAt)}
                          </p>
                        </div>
                        {/* Play button */}
                        <Link href={`/watch/${entry.episodeId}`}>
                          <div className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-white/30 group-hover:text-white group-hover:border-white/30 transition-colors flex-shrink-0">
                            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                          </div>
                        </Link>
                      </motion.div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
            </AnimatePresence>

            {/* ── Reviews tab ── */}
            <AnimatePresence mode="wait">
            {activeTab === "reviews" && (
            <motion.div key="reviews" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
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
            </motion.div>
            )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ── Avatar Picker Modal ── */}
      {avatarPickerOpen && profile && (
        <AvatarPickerModal
          userId={profile.id}
          onSave={(updatedUser) => {
            setProfile(p => p ? { ...p, avatarUrl: updatedUser.avatarUrl } : p);
            loginWithUser(updatedUser);
            setAvatarPickerOpen(false);
          }}
          onSkip={() => setAvatarPickerOpen(false)}
        />
      )}

      {/* ── Edit Profile Modal ── */}
      <AnimatePresence>
        {editOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 z-50"
              onClick={() => !editSaving && setEditOpen(false)}
            />
            <motion.div
              key="modal"
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
              <div
                className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md p-6 pointer-events-auto"
                onClick={e => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-base font-semibold text-white">Edit Profile</h2>
                  <button
                    onClick={() => setEditOpen(false)}
                    disabled={editSaving}
                    className="text-white/40 hover:text-white/70 transition-colors disabled:opacity-40"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Fields */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] uppercase tracking-widest text-white/40 font-mono mb-1.5">
                      Display Name
                    </label>
                    <input
                      ref={displayNameRef}
                      type="text"
                      value={editDisplayName}
                      onChange={e => setEditDisplayName(e.target.value)}
                      disabled={editSaving}
                      maxLength={50}
                      className="w-full bg-zinc-800 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/30 transition-colors disabled:opacity-50"
                      placeholder="Your display name"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-widest text-white/40 font-mono mb-1.5">
                      Bio
                    </label>
                    <textarea
                      value={editBio}
                      onChange={e => setEditBio(e.target.value)}
                      disabled={editSaving}
                      maxLength={200}
                      rows={3}
                      className="w-full bg-zinc-800 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/30 transition-colors resize-none disabled:opacity-50"
                      placeholder="Tell people about yourself…"
                    />
                    <p className="text-[10px] text-white/25 text-right mt-1">{editBio.length}/200</p>
                  </div>
                </div>

                {/* Error */}
                {editError && (
                  <p className="mt-3 text-sm text-red-400">{editError}</p>
                )}

                {/* Actions */}
                <div className="flex gap-3 mt-5">
                  <button
                    onClick={() => setEditOpen(false)}
                    disabled={editSaving}
                    className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm text-white/50 hover:text-white/80 transition-colors disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveEdit}
                    disabled={editSaving || !editDisplayName.trim()}
                    className="flex-1 py-2.5 rounded-xl bg-white text-black text-sm font-semibold hover:bg-white/90 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {editSaving ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                    ) : (
                      <><Check className="w-3.5 h-3.5" /> Save</>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

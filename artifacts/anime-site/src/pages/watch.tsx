import { motion, AnimatePresence } from "framer-motion";
import { Link, useParams } from "wouter";
import { useState, useEffect } from "react";
import { ThumbsUp, Send, Play, Star, LayoutGrid, List, Search, ArrowLeft, Clock, Bookmark, BookmarkCheck, CheckCircle2, ChevronDown } from "lucide-react";
import {
  useGetEpisode,
  getGetEpisodeQueryKey,
  useListEpisodeComments,
  getListEpisodeCommentsQueryKey,
  useCreateEpisodeComment,
  useLikeComment,
  useListEpisodes,
  getListEpisodesQueryKey,
  useGetAnime,
  getGetAnimeQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWatchProgress } from "@/hooks/useWatchProgress";
import { useWatchlist } from "@/hooks/useWatchlist";
import { VideoPlayer } from "@/components/video-player";

export default function Watch() {
  const params = useParams();
  const episodeId = parseInt(params.episodeId ?? "0");
  const queryClient = useQueryClient();
  const { markWatched, isWatched } = useWatchProgress();
  const { toggle, isInList } = useWatchlist();

  const [username, setUsername] = useState("");
  const [comment, setComment] = useState("");
  const [epSearch, setEpSearch] = useState("");
  const [gridView, setGridView] = useState(false);
  const [commentSort, setCommentSort] = useState<"Newest" | "Best" | "Oldest">("Newest");
  const [showMobileEpisodes, setShowMobileEpisodes] = useState(false);
  const [seasonFilter, setSeasonFilter] = useState<number | null>(null);

  const { data: episode, isLoading } = useGetEpisode(episodeId, {
    query: { enabled: !!episodeId, queryKey: getGetEpisodeQueryKey(episodeId) },
  });
  const { data: comments } = useListEpisodeComments(episodeId, {
    query: { enabled: !!episodeId, queryKey: getListEpisodeCommentsQueryKey(episodeId) },
  });
  const { data: episodes } = useListEpisodes(episode?.animeId ?? 0, {
    query: { enabled: !!episode?.animeId, queryKey: getListEpisodesQueryKey(episode?.animeId ?? 0) },
  });
  const { data: anime } = useGetAnime(episode?.animeId ?? 0, {
    query: { enabled: !!episode?.animeId, queryKey: getGetAnimeQueryKey(episode?.animeId ?? 0) },
  });

  useEffect(() => {
    if (!episode?.animeId) return;
    const timer = setTimeout(() => {
      markWatched(episodeId, episode.animeId, {
        animeTitle: anime?.title,
        coverImage: anime?.coverImage,
        episodeNumber: episode?.episodeNumber,
      });
    }, 10_000);
    return () => clearTimeout(timer);
  }, [episodeId, episode?.animeId, anime?.title, anime?.coverImage, episode?.episodeNumber, markWatched]);

  // Reset season filter when anime changes
  useEffect(() => { setSeasonFilter(null); }, [episode?.animeId]);

  const saved = isInList(episode?.animeId ?? 0);
  const watched = isWatched(episodeId);

  const createComment = useCreateEpisodeComment();
  const likeComment = useLikeComment();

  const handleSubmit = () => {
    if (!username.trim() || !comment.trim()) return;
    createComment.mutate(
      { id: episodeId, data: { username: username.trim(), content: comment.trim() } },
      {
        onSuccess: () => {
          setComment("");
          queryClient.invalidateQueries({ queryKey: getListEpisodeCommentsQueryKey(episodeId) });
        },
      }
    );
  };

  const handleLike = (id: number) => {
    likeComment.mutate(
      { id },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEpisodeCommentsQueryKey(episodeId) }) }
    );
  };

  // Derive available seasons
  const seasons = episodes
    ? [...new Set(episodes.map((ep) => ep.season))].sort((a, b) => a - b)
    : [];

  const filteredEpisodes = episodes?.filter((ep) => {
    const matchesSeason = seasonFilter === null || ep.season === seasonFilter;
    const matchesSearch = !epSearch || ep.title.toLowerCase().includes(epSearch.toLowerCase()) || String(ep.episodeNumber).includes(epSearch);
    return matchesSeason && matchesSearch;
  });

  const sortedComments = [...(comments ?? [])].sort((a, b) => {
    if (commentSort === "Best") return b.likes - a.likes;
    if (commentSort === "Oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-10 h-10 border border-white/20 border-t-white animate-spin rounded-full" />
      </div>
    );
  }

  if (!episode) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-white/40 font-mono">Episode not found</p>
      </div>
    );
  }

  const episodeLabel = `Season ${episode.season} · Episode ${episode.episodeNumber}`;

  const EpisodeList = () => (
    <div className="space-y-0.5">
      {filteredEpisodes?.map((ep) => (
        <Link key={ep.id} href={`/watch/${ep.id}`}>
          <div
            className={`group flex gap-3 p-2.5 border transition-all cursor-pointer ${ep.id === episodeId ? "border-white/20 bg-white/5" : "border-transparent hover:border-white/10 hover:bg-white/[0.02]"}`}
            data-testid={`sidebar-ep-${ep.id}`}
            onClick={() => setShowMobileEpisodes(false)}
          >
            <div className="relative flex-shrink-0 w-20 h-12 overflow-hidden bg-zinc-900">
              <img src={ep.thumbnailUrl} alt="" className="w-full h-full object-cover transition-all duration-300" />
              {ep.id === episodeId && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <Play className="w-3.5 h-3.5 text-white fill-white" />
                </div>
              )}
              {isWatched(ep.id) && ep.id !== episodeId && (
                <div className="absolute bottom-1 right-1">
                  <CheckCircle2 className="w-3 h-3 text-white/70 drop-shadow" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-mono text-white/30 mb-0.5">S{ep.season} E{ep.episodeNumber}</p>
              <p className={`text-xs line-clamp-2 leading-snug ${ep.id === episodeId ? "text-white" : isWatched(ep.id) ? "text-white/40" : "text-white/60 group-hover:text-white"} transition-colors`}>{ep.title}</p>
              <p className="text-[9px] font-mono text-white/20 mt-0.5">{ep.releaseDate}</p>
            </div>
          </div>
        </Link>
      ))}
      {filteredEpisodes?.length === 0 && (
        <p className="text-white/25 text-xs font-mono text-center py-6">No episodes found</p>
      )}
    </div>
  );

  return (
    <div className="bg-black text-white min-h-screen flex">
      {/* Left sidebar — anime info */}
      <div className="hidden lg:flex flex-col w-56 flex-shrink-0 border-r border-white/5 bg-zinc-950/60 p-4 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto">
        <Link href={`/anime/${episode.animeId}`}>
          <button className="flex items-center gap-1.5 text-white/30 hover:text-white text-[10px] font-mono uppercase tracking-widest transition-colors mb-4">
            <ArrowLeft className="w-3 h-3" /> Back
          </button>
        </Link>
        {anime && (
          <>
            <div className="aspect-[2/3] overflow-hidden border border-white/10 mb-4">
              <img src={anime.coverImage} alt={anime.title} className="w-full h-full object-cover transition-all duration-500" />
            </div>
            <h3 className="font-serif text-base text-white mb-1 leading-snug">{anime.title}</h3>
            {anime.japaneseTitle && (
              <p className="text-white/30 text-[9px] font-mono uppercase tracking-widest mb-3">{anime.japaneseTitle}</p>
            )}
            <div className="flex flex-wrap gap-1.5 mb-3">
              <span className="text-[9px] font-mono text-white/40 border border-white/10 px-2 py-0.5 uppercase">{anime.totalEpisodes} eps</span>
              <span className="text-[9px] font-mono text-white/40 border border-white/10 px-2 py-0.5 uppercase">{anime.status}</span>
              {anime.rating && (
                <span className="flex items-center gap-0.5 text-[9px] font-mono text-white/40 border border-white/10 px-2 py-0.5">
                  <Star className="w-2.5 h-2.5" />{anime.rating.toFixed(1)}
                </span>
              )}
            </div>
            <div className="text-[9px] font-mono text-white/25 uppercase tracking-widest space-y-1">
              <div className="flex justify-between"><span>Start</span><span className="text-white/50">{anime.releaseYear}</span></div>
              <div className="flex justify-between"><span>Studio</span><span className="text-white/50 truncate ml-2 text-right">{anime.studio}</span></div>
              <div className="flex justify-between"><span>Country</span><span className="text-white/50">JP</span></div>
            </div>
          </>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 md:hidden">
          <Link href={`/anime/${episode.animeId}`}>
            <button className="flex items-center gap-1.5 text-white/40 text-[10px] font-mono uppercase tracking-widest">
              <ArrowLeft className="w-3.5 h-3.5" />
              {anime?.title ?? "Back"}
            </button>
          </Link>
          <span className="ml-auto text-[10px] font-mono text-white/30">S{episode.season} E{episode.episodeNumber}</span>
        </div>

        {/* ── VIDEO PLAYER ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="w-full bg-black border-b border-white/5"
          style={{ aspectRatio: "16/9" }}
        >
          <VideoPlayer
            src={episode.streamUrl}
            poster={episode.thumbnailUrl}
            title={episode.title}
            episodeLabel={episodeLabel}
            data-testid="video-player"
          />
        </motion.div>

        {/* Report bar */}
        <div className="flex items-center gap-2 bg-white/[0.03] border-b border-white/5 px-4 sm:px-6 py-2">
          <div className="w-3.5 h-3.5 border border-white/20 flex items-center justify-center flex-shrink-0">
            <span className="text-[8px] text-white/40">!</span>
          </div>
          <p className="text-white/40 text-xs font-mono">If episode is not working, please report it.</p>
        </div>

        {/* Episode info + quality buttons */}
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-6 px-4 sm:px-6 py-3 sm:py-4 border-b border-white/5">
          <div className="flex-1">
            <p className="text-white/30 text-[10px] font-mono uppercase tracking-widest mb-0.5">You are watching</p>
            <p className="text-white font-medium text-sm leading-snug">{episode.title}</p>
            <p className="text-white/40 text-[10px] font-mono uppercase tracking-widest mt-0.5">{episodeLabel}</p>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-2">
              {watched && (
                <span className="flex items-center gap-1 text-[9px] font-mono text-white/40 uppercase tracking-widest">
                  <CheckCircle2 className="w-3 h-3" /> Watched
                </span>
              )}
              {episode.animeId > 0 && (
                <button
                  onClick={() => toggle(episode.animeId)}
                  className={`flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest border px-2.5 py-1 transition-all ${
                    saved ? "border-white text-white bg-white/10" : "border-white/15 text-white/40 hover:border-white/40 hover:text-white"
                  }`}
                >
                  {saved ? <BookmarkCheck className="w-3 h-3" /> : <Bookmark className="w-3 h-3" />}
                  {saved ? "In My List" : "Add to List"}
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-4 sm:gap-6 flex-shrink-0">
            <div>
              <p className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                <span className="w-3 h-3 border border-white/20 flex items-center justify-center text-[7px]">S</span> SUB:
              </p>
              <div className="flex gap-1">
                <button className="text-[9px] font-mono border border-white/30 text-white px-2 sm:px-3 py-1">HD-2</button>
                <button className="text-[9px] font-mono border border-white/10 text-white/40 px-2 sm:px-3 py-1">HD-1</button>
              </div>
            </div>
            <div>
              <p className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                <span className="w-3 h-3 border border-white/20 flex items-center justify-center text-[7px]">D</span> DUB:
              </p>
              <div className="flex gap-1">
                <button className="text-[9px] font-mono border border-white/10 text-white/40 px-2 sm:px-3 py-1">HD-2</button>
                <button className="text-[9px] font-mono border border-white/10 text-white/40 px-2 sm:px-3 py-1">HD-1</button>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile episode list toggle */}
        <div className="md:hidden border-b border-white/5">
          <button
            onClick={() => setShowMobileEpisodes(!showMobileEpisodes)}
            className="w-full flex items-center justify-between px-4 py-3 text-white/60 hover:text-white transition-colors"
          >
            <span className="text-xs font-mono uppercase tracking-widest">
              Episodes ({episodes?.length ?? 0})
            </span>
            <motion.div animate={{ rotate: showMobileEpisodes ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown className="w-4 h-4" />
            </motion.div>
          </button>
          <AnimatePresence>
            {showMobileEpisodes && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden border-t border-white/5 max-h-64 overflow-y-auto"
              >
                <EpisodeList />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Comments */}
        <div className="px-4 sm:px-6 py-5 sm:py-6">
          <div className="flex items-center gap-3 sm:gap-4 mb-5 sm:mb-6">
            <h2 className="text-white font-serif text-xl sm:text-2xl">Comments</h2>
            <span className="bg-white text-black text-[10px] font-bold px-2 py-0.5">{comments?.length ?? 0}</span>
            <div className="ml-auto flex gap-1">
              {(["Best", "Newest", "Oldest"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setCommentSort(s)}
                  className={`text-[10px] sm:text-xs px-2 sm:px-3 py-1.5 font-mono uppercase tracking-widest transition-colors ${commentSort === s ? "bg-white text-black" : "text-white/40 hover:text-white border border-white/10"}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 mb-6 sm:mb-8">
            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=user" alt="" className="w-8 h-8 rounded-full grayscale flex-shrink-0 mt-1" />
            <div className="flex-1 border-b border-white/10">
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-transparent text-white/50 text-sm placeholder:text-white/20 focus:outline-none py-1 mb-2"
                data-testid="input-username"
              />
              <div className="flex items-end gap-3">
                <textarea
                  placeholder="Create a post..."
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                  className="flex-1 bg-transparent text-white text-sm placeholder:text-white/25 focus:outline-none resize-none"
                  data-testid="input-comment"
                />
                <button
                  onClick={handleSubmit}
                  disabled={createComment.isPending}
                  className="flex items-center gap-1.5 bg-white text-black px-3 sm:px-4 py-2 text-[10px] font-bold uppercase tracking-widest hover:bg-white/90 transition-colors disabled:opacity-40 flex-shrink-0 mb-1"
                  data-testid="button-submit-comment"
                >
                  <Send className="w-3 h-3" /> Post
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            {sortedComments.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="flex gap-3"
                data-testid={`comment-${c.id}`}
              >
                <img src={c.avatarUrl} alt={c.username} className="w-8 h-8 rounded-full grayscale flex-shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1.5">
                    <span className="text-white text-sm font-medium">{c.username}</span>
                    <span className="text-white/25 text-[10px] font-mono">{new Date(c.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-white/65 text-sm leading-relaxed">{c.content}</p>
                  <button
                    onClick={() => handleLike(c.id)}
                    className="flex items-center gap-1.5 mt-2 text-white/30 hover:text-white text-[10px] font-mono transition-colors"
                    data-testid={`like-${c.id}`}
                  >
                    <ThumbsUp className="w-3 h-3" /> {c.likes}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* Right sidebar — episode list */}
      <div className="hidden md:flex flex-col w-72 flex-shrink-0 border-l border-white/5 bg-zinc-950/50 sticky top-14 h-[calc(100vh-56px)]">
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-serif text-base text-white flex items-center gap-2">
              Episodes
              <span className="text-white/30 font-mono text-sm font-normal">{episodes?.length ?? 0}</span>
            </h3>
            <div className="flex gap-1">
              <button onClick={() => setGridView(false)} className={`p-1 transition-colors ${!gridView ? "text-white" : "text-white/30"}`}><List className="w-3.5 h-3.5" /></button>
              <button onClick={() => setGridView(true)} className={`p-1 transition-colors ${gridView ? "text-white" : "text-white/30"}`}><LayoutGrid className="w-3.5 h-3.5" /></button>
            </div>
          </div>

          {/* Season filter tabs */}
          {seasons.length > 1 && (
            <div className="flex gap-1 mb-3 flex-wrap">
              <button
                onClick={() => setSeasonFilter(null)}
                className={`text-[9px] font-mono uppercase tracking-widest px-2 py-1 border transition-colors ${seasonFilter === null ? "border-white text-white bg-white/10" : "border-white/15 text-white/40 hover:border-white/30 hover:text-white"}`}
              >
                All
              </button>
              {seasons.map((s) => (
                <button
                  key={s}
                  onClick={() => setSeasonFilter(s)}
                  className={`text-[9px] font-mono uppercase tracking-widest px-2 py-1 border transition-colors ${seasonFilter === s ? "border-white text-white bg-white/10" : "border-white/15 text-white/40 hover:border-white/30 hover:text-white"}`}
                >
                  S{s}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 bg-white/[0.03] border border-white/10 px-3 py-2">
            <Search className="w-3.5 h-3.5 text-white/25" />
            <input
              type="search"
              placeholder="Search episodes..."
              value={epSearch}
              onChange={(e) => setEpSearch(e.target.value)}
              className="flex-1 bg-transparent text-white text-xs placeholder:text-white/25 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {gridView ? (
            <div className="grid grid-cols-3 gap-1.5 p-1">
              {filteredEpisodes?.map((ep) => (
                <Link key={ep.id} href={`/watch/${ep.id}`}>
                  <div className={`relative aspect-video overflow-hidden cursor-pointer border ${ep.id === episodeId ? "border-white" : "border-white/5 hover:border-white/20"} transition-all`}>
                    <img src={ep.thumbnailUrl} alt={ep.title} className="w-full h-full object-cover transition-all duration-300" />
                    <div className={`absolute bottom-0 left-0 right-0 text-center text-[8px] font-mono py-0.5 ${ep.id === episodeId ? "bg-white text-black" : "bg-black/70 text-white/60"}`}>
                      S{ep.season}E{ep.episodeNumber}
                    </div>
                    {ep.id === episodeId && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <Play className="w-4 h-4 text-white fill-white" />
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EpisodeList />
          )}
        </div>
      </div>
    </div>
  );
}

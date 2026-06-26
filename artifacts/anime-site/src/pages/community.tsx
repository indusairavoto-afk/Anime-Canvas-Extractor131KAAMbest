import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { Link } from "wouter";
import { ThumbsUp, MessageCircle, PenLine, X, Pin, Users, Trash2, ImagePlay } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import {
  useListCommunityPosts,
  getListCommunityPostsQueryKey,
  useCreateCommunityPost,
  useDeleteCommunityPost,
  useLikeCommunityPost,
  getGetCommunityPostQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import GifPicker from "@/components/GifPicker";

const CATEGORIES = ["All", "Discussion", "News", "Review", "Recommendation", "Fan Art", "Other"];

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const fadeUp = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } };

const GENERIC_AVATAR = "https://api.dicebear.com/7.x/avataaars/svg?seed=guest";

export default function Community() {
  const { user } = useAuth();
  const [category, setCategory] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [username, setUsername] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [postCategory, setPostCategory] = useState("Discussion");
  const [gifUrl, setGifUrl] = useState("");
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [likedIds, setLikedIds] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();

  const params = category !== "All" ? { category } : undefined;
  const { data: posts, isLoading } = useListCommunityPosts(params);
  const createPost = useCreateCommunityPost();
  const deletePost = useDeleteCommunityPost();
  const likePost = useLikeCommunityPost();

  const handleSubmit = () => {
    const poster = user?.username || username.trim();
    if (!poster || !title.trim() || !content.trim()) return;
    createPost.mutate(
      { data: { username: poster, title: title.trim(), content: content.trim(), category: postCategory, imageUrl: gifUrl || null } },
      {
        onSuccess: () => {
          setShowForm(false);
          setTitle("");
          setContent("");
          setGifUrl("");
          queryClient.invalidateQueries({ queryKey: getListCommunityPostsQueryKey() });
        },
      }
    );
  };

  const handleDelete = (postId: number) => {
    if (!user) return;
    deletePost.mutate(
      { id: postId, data: { username: user.username } },
      {
        onSuccess: () => {
          setConfirmDeleteId(null);
          queryClient.invalidateQueries({ queryKey: getListCommunityPostsQueryKey() });
        },
      }
    );
  };

  const handleLike = (e: React.MouseEvent, postId: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (likedIds.has(postId)) return;
    setLikedIds((prev) => new Set([...prev, postId]));
    likePost.mutate(
      { id: postId },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetCommunityPostQueryKey(postId), data);
          queryClient.invalidateQueries({ queryKey: getListCommunityPostsQueryKey() });
        },
        onError: () => {
          setLikedIds((prev) => { const s = new Set(prev); s.delete(postId); return s; });
        },
      }
    );
  };

  const pinnedPosts = Array.isArray(posts) ? posts.slice(0, 3) : [];
  const regularPosts = Array.isArray(posts) ? posts.slice(3) : [];

  return (
    <div className="bg-black text-white min-h-screen">
      <section className="relative overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
        <div className="relative text-center py-16 px-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="w-16 h-16 bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-6"
          >
            <Users className="w-7 h-7 text-white/60" />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <h1 className="font-serif text-5xl text-white mb-3">
              COMMUNITY <span className="text-white/30">HUB</span>
            </h1>
            <p className="text-white/50 text-sm max-w-md mx-auto">
              Join the discussion, share your art, and connect with fellow anime enthusiasts.
            </p>
          </motion.div>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8">
        {pinnedPosts.length > 0 && (
          <div className="mb-10">
            <div className="flex items-center gap-2 mb-4">
              <Pin className="w-3.5 h-3.5 text-white/30" />
              <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/40">Pinned Posts</span>
            </div>
            <motion.div variants={stagger} initial="hidden" animate="show" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {pinnedPosts.map((post) => (
                <motion.div key={post.id} variants={fadeUp} className="relative group/card">
                  <Link href={`/community/${post.id}`}>
                    <div className="relative border border-white/5 hover:border-white/20 transition-all cursor-pointer overflow-hidden aspect-[4/3] flex flex-col">
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent z-10" />
                      <div className="absolute inset-0 bg-white/[0.015]" />
                      {post.imageUrl && (
                        <img src={post.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />
                      )}
                      <div className="relative z-20 flex flex-col h-full p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[8px] font-mono uppercase tracking-widest border border-white/15 px-2 py-0.5 text-white/50">{post.category}</span>
                          <span className="flex items-center gap-1 text-[8px] font-mono text-white bg-white/10 px-2 py-0.5">
                            <Pin className="w-2 h-2" /> PINNED
                          </span>
                        </div>
                        <div className="mt-auto">
                          <h3 className="text-white font-medium text-sm leading-snug mb-1 line-clamp-2">{post.title}</h3>
                          <p className="text-white/40 text-[10px] font-mono">by {post.username}</p>
                        </div>
                      </div>
                    </div>
                  </Link>
                  {user && user.username === post.username && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(post.id); }}
                      className="absolute top-2 right-2 z-30 p-1.5 bg-black/70 text-white/40 hover:text-red-400 hover:bg-black/90 transition-colors opacity-0 group-hover/card:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </motion.div>
              ))}
            </motion.div>
          </div>
        )}

        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div className="flex gap-1 flex-wrap">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-colors ${category === cat ? "bg-white text-black" : "text-white/40 hover:text-white border border-white/5 hover:border-white/20"}`}
              >
                {cat}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 border border-white/15 px-4 py-2 text-[10px] font-bold uppercase tracking-widest hover:bg-white hover:text-black transition-colors flex-shrink-0"
          >
            <PenLine className="w-3.5 h-3.5" /> New Post
          </button>
        </div>

        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="border border-white/10 p-5 mb-6 space-y-4 overflow-hidden"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-lg text-white">New Post</h3>
              <button onClick={() => { setShowForm(false); setGifUrl(""); }} className="text-white/30 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {user ? (
                <p className="text-white/60 text-sm self-center">Posting as <span className="text-white font-medium">{user.username}</span></p>
              ) : (
                <input type="text" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)}
                  className="bg-transparent border-b border-white/10 pb-2 text-white text-sm placeholder:text-white/25 focus:outline-none" />
              )}
              <select value={postCategory} onChange={(e) => setPostCategory(e.target.value)}
                className="bg-black border-b border-white/10 pb-2 text-white/70 text-sm focus:outline-none">
                {CATEGORIES.filter((c) => c !== "All").map((c) => <option key={c} value={c} className="bg-black">{c}</option>)}
              </select>
            </div>
            <input type="text" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-transparent border-b border-white/10 pb-2 text-white text-sm placeholder:text-white/25 focus:outline-none" />
            <textarea placeholder="What's on your mind?" value={content} onChange={(e) => setContent(e.target.value)} rows={4}
              className="w-full bg-transparent text-white/80 text-sm placeholder:text-white/25 focus:outline-none resize-none" />

            {/* GIF preview */}
            {gifUrl && (
              <div className="relative group/gif border border-white/10">
                <img src={gifUrl} alt="Selected GIF" className="w-full max-h-52 object-contain bg-zinc-900" />
                <button
                  onClick={() => setGifUrl("")}
                  className="absolute top-2 right-2 p-1 bg-black/70 text-white/60 hover:text-white transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowGifPicker(true)}
                className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-white/30 hover:text-white border border-white/8 hover:border-white/25 px-3 py-1.5 transition-colors"
              >
                <ImagePlay className="w-3.5 h-3.5" />
                {gifUrl ? "Change GIF" : "Add GIF"}
              </button>
              <button onClick={handleSubmit} disabled={createPost.isPending}
                className="bg-white text-black px-8 py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-white/90 transition-colors disabled:opacity-40">
                {createPost.isPending ? "Posting..." : "Publish"}
              </button>
            </div>
          </motion.div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 bg-white/[0.02] animate-pulse border border-white/5" />)}
          </div>
        ) : (
          <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-2">
            <div className="flex items-center gap-3 border border-white/5 p-4 mb-3">
              <img src={user?.avatarUrl ?? GENERIC_AVATAR} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0 bg-zinc-700" />
              <button onClick={() => setShowForm(true)} className="flex-1 text-left text-white/25 text-sm hover:text-white/40 transition-colors">
                Create a post...
              </button>
            </div>

            {regularPosts.map((post) => (
              <motion.div key={post.id} variants={fadeUp} className="group/row relative">
                <Link href={`/community/${post.id}`}>
                  <div className="flex items-start gap-4 border border-white/5 p-5 hover:border-white/15 hover:bg-white/[0.02] transition-all cursor-pointer">
                    <img src={post.avatarUrl} alt={post.username} className="w-9 h-9 rounded-full grayscale flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0 pr-8">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="text-[9px] font-mono uppercase tracking-widest border border-white/10 px-2 py-0.5 text-white/40">{post.category}</span>
                        <span className="text-white text-xs font-medium">{post.username}</span>
                        <span className="text-white/25 text-[9px] font-mono">{new Date(post.createdAt).toLocaleDateString()}</span>
                      </div>
                      <h3 className="text-white font-serif text-lg group-hover/row:text-white/90 transition-colors mb-1">{post.title}</h3>
                      <p className="text-white/45 text-sm line-clamp-2">{post.content}</p>
                      {/* GIF thumbnail strip */}
                      {post.imageUrl && (
                        <div className="mt-3 w-24 h-14 overflow-hidden border border-white/8">
                          <img src={post.imageUrl} alt="" className="w-full h-full object-cover" />
                        </div>
                      )}
                      <div className="flex items-center gap-5 mt-3 text-[10px] font-mono text-white/30 uppercase tracking-widest">
                        <button
                          onClick={(e) => handleLike(e, post.id)}
                          className={`flex items-center gap-1.5 transition-colors ${likedIds.has(post.id) ? "text-white" : "hover:text-white/60"}`}
                          title="Like"
                        >
                          <ThumbsUp className={`w-3 h-3 ${likedIds.has(post.id) ? "fill-white" : ""}`} />
                          {post.likes + (likedIds.has(post.id) ? 1 : 0)}
                        </button>
                        <span className="flex items-center gap-1.5"><MessageCircle className="w-3 h-3" />{post.commentCount}</span>
                      </div>
                    </div>
                  </div>
                </Link>
                {user && user.username === post.username && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(post.id); }}
                    className="absolute top-4 right-4 p-1.5 text-white/20 hover:text-red-400 transition-colors opacity-0 group-hover/row:opacity-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* GIF Picker */}
      <AnimatePresence>
        {showGifPicker && (
          <GifPicker
            onSelect={(url) => setGifUrl(url)}
            onClose={() => setShowGifPicker(false)}
          />
        )}
      </AnimatePresence>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {confirmDeleteId !== null && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
            onClick={() => setConfirmDeleteId(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-zinc-950 border border-white/10 p-8 max-w-sm w-full"
            >
              <h3 className="font-serif text-xl text-white mb-2">Delete Post?</h3>
              <p className="text-white/50 text-sm mb-6">This will permanently remove the post and all its replies. This cannot be undone.</p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setConfirmDeleteId(null)}
                  className="px-5 py-2 text-xs font-mono uppercase tracking-widest text-white/50 hover:text-white border border-white/10 hover:border-white/30 transition-colors">
                  Cancel
                </button>
                <button onClick={() => handleDelete(confirmDeleteId)} disabled={deletePost.isPending}
                  className="px-5 py-2 text-xs font-mono uppercase tracking-widest bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50">
                  {deletePost.isPending ? "Deleting…" : "Delete"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

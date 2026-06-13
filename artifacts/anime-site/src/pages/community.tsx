import { motion } from "framer-motion";
import { useState } from "react";
import { Link } from "wouter";
import { ThumbsUp, MessageCircle, PenLine, X, Pin, Users } from "lucide-react";
import {
  useListCommunityPosts,
  getListCommunityPostsQueryKey,
  useCreateCommunityPost,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const CATEGORIES = ["All", "Discussion", "News", "Review", "Recommendation", "Fan Art", "Other"];

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const fadeUp = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } };

export default function Community() {
  const [category, setCategory] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [username, setUsername] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [postCategory, setPostCategory] = useState("Discussion");
  const queryClient = useQueryClient();

  const params = category !== "All" ? { category } : undefined;
  const { data: posts, isLoading } = useListCommunityPosts(params);
  const createPost = useCreateCommunityPost();

  const handleSubmit = () => {
    if (!username.trim() || !title.trim() || !content.trim()) return;
    createPost.mutate(
      { data: { username: username.trim(), title: title.trim(), content: content.trim(), category: postCategory } },
      {
        onSuccess: () => {
          setShowForm(false);
          setTitle("");
          setContent("");
          queryClient.invalidateQueries({ queryKey: getListCommunityPostsQueryKey() });
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
            <motion.div
              variants={stagger}
              initial="hidden"
              animate="show"
              className="grid grid-cols-1 sm:grid-cols-3 gap-3"
            >
              {pinnedPosts.map((post) => (
                <motion.div key={post.id} variants={fadeUp}>
                  <Link href={`/community/${post.id}`}>
                    <div className="group relative border border-white/5 hover:border-white/20 transition-all cursor-pointer overflow-hidden aspect-[4/3] flex flex-col">
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent z-10" />
                      <div className="absolute inset-0 bg-white/[0.015]" />
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
                data-testid={`tab-${cat}`}
              >
                {cat}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 border border-white/15 px-4 py-2 text-[10px] font-bold uppercase tracking-widest hover:bg-white hover:text-black transition-colors flex-shrink-0"
            data-testid="btn-new-post"
          >
            <PenLine className="w-3.5 h-3.5" /> New Post
          </button>
        </div>

        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="border border-white/10 p-5 mb-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-lg text-white">New Post</h3>
              <button onClick={() => setShowForm(false)} className="text-white/30 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <input type="text" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)}
                className="bg-transparent border-b border-white/10 pb-2 text-white text-sm placeholder:text-white/25 focus:outline-none" data-testid="input-username" />
              <select value={postCategory} onChange={(e) => setPostCategory(e.target.value)}
                className="bg-black border-b border-white/10 pb-2 text-white/70 text-sm focus:outline-none" data-testid="select-category">
                {CATEGORIES.filter((c) => c !== "All").map((c) => <option key={c} value={c} className="bg-black">{c}</option>)}
              </select>
            </div>
            <input type="text" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-transparent border-b border-white/10 pb-2 text-white text-sm placeholder:text-white/25 focus:outline-none" data-testid="input-title" />
            <textarea placeholder="What's on your mind?" value={content} onChange={(e) => setContent(e.target.value)} rows={4}
              className="w-full bg-transparent text-white/80 text-sm placeholder:text-white/25 focus:outline-none resize-none" data-testid="input-content" />
            <div className="flex justify-end">
              <button onClick={handleSubmit} disabled={createPost.isPending}
                className="bg-white text-black px-8 py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-white/90 transition-colors disabled:opacity-40" data-testid="btn-submit">
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
              <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=user" alt="" className="w-8 h-8 rounded-full grayscale flex-shrink-0" />
              <button
                onClick={() => setShowForm(true)}
                className="flex-1 text-left text-white/25 text-sm hover:text-white/40 transition-colors"
              >
                Create a post...
              </button>
            </div>

            {regularPosts.map((post) => (
              <motion.div key={post.id} variants={fadeUp}>
                <Link href={`/community/${post.id}`}>
                  <div className="group flex items-start gap-4 border border-white/5 p-5 hover:border-white/15 hover:bg-white/[0.02] transition-all cursor-pointer" data-testid={`post-${post.id}`}>
                    <img src={post.avatarUrl} alt={post.username} className="w-9 h-9 rounded-full grayscale flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="text-[9px] font-mono uppercase tracking-widest border border-white/10 px-2 py-0.5 text-white/40">{post.category}</span>
                        <span className="text-white text-xs font-medium">{post.username}</span>
                        <span className="text-white/25 text-[9px] font-mono">{new Date(post.createdAt).toLocaleDateString()}</span>
                      </div>
                      <h3 className="text-white font-serif text-lg group-hover:text-white/90 transition-colors mb-1">{post.title}</h3>
                      <p className="text-white/45 text-sm line-clamp-2">{post.content}</p>
                      <div className="flex items-center gap-5 mt-3 text-[10px] font-mono text-white/30 uppercase tracking-widest">
                        <span className="flex items-center gap-1.5"><ThumbsUp className="w-3 h-3" />{post.likes}</span>
                        <span className="flex items-center gap-1.5"><MessageCircle className="w-3 h-3" />{post.commentCount}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}

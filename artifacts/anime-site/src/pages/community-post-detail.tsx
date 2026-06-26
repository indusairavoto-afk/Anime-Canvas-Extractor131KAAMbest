import { motion, AnimatePresence } from "framer-motion";
import { Link, useParams, useLocation } from "wouter";
import { useState } from "react";
import { ArrowLeft, ThumbsUp, MessageCircle, Send, Trash2 } from "lucide-react";
import {
  useGetCommunityPost,
  getGetCommunityPostQueryKey,
  useListPostComments,
  getListPostCommentsQueryKey,
  useCreatePostComment,
  useDeleteCommunityPost,
  useDeleteComment,
  useLikeCommunityPost,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";

export default function CommunityPostDetail() {
  const params = useParams();
  const id = parseInt(params.id ?? "0");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [comment, setComment] = useState("");
  const [confirmDeletePost, setConfirmDeletePost] = useState(false);
  const [confirmDeleteCommentId, setConfirmDeleteCommentId] = useState<number | null>(null);
  const [liked, setLiked] = useState(false);

  const { data: post, isLoading } = useGetCommunityPost(id, {
    query: { enabled: !!id, queryKey: getGetCommunityPostQueryKey(id) },
  });
  const { data: comments } = useListPostComments(id, {
    query: { enabled: !!id, queryKey: getListPostCommentsQueryKey(id) },
  });
  const createComment = useCreatePostComment();
  const deletePost = useDeleteCommunityPost();
  const deleteComment = useDeleteComment();
  const likePost = useLikeCommunityPost();

  const handleSubmit = () => {
    if (!user || !comment.trim()) return;
    createComment.mutate(
      { id, data: { username: user.username, content: comment.trim() } },
      {
        onSuccess: () => {
          setComment("");
          queryClient.invalidateQueries({ queryKey: getListPostCommentsQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetCommunityPostQueryKey(id) });
        },
      }
    );
  };

  const handleLike = () => {
    if (liked) return;
    setLiked(true);
    likePost.mutate(
      { id },
      {
        onSuccess: (data) => queryClient.setQueryData(getGetCommunityPostQueryKey(id), data),
        onError: () => setLiked(false),
      }
    );
  };

  const handleDeletePost = () => {
    if (!user || !post) return;
    deletePost.mutate(
      { id, data: { username: user.username } },
      { onSuccess: () => navigate("/community") }
    );
  };

  const handleDeleteComment = (commentId: number) => {
    if (!user) return;
    deleteComment.mutate(
      { id: commentId, data: { username: user.username } },
      {
        onSuccess: () => {
          setConfirmDeleteCommentId(null);
          queryClient.invalidateQueries({ queryKey: getListPostCommentsQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetCommunityPostQueryKey(id) });
        },
      }
    );
  };

  const isMyPost = !!(user && post && user.username === post.username);
  const displayLikes = (post?.likes ?? 0) + (liked ? 1 : 0);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-16 space-y-6">
          <div className="h-8 bg-white/5 w-1/3 animate-pulse" />
          <div className="h-14 bg-white/5 w-full animate-pulse" />
          <div className="h-4 bg-white/5 w-full animate-pulse" />
          <div className="h-4 bg-white/5 w-3/4 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-white/40 font-mono">Post not found</p>
      </div>
    );
  }

  return (
    <div className="bg-black text-white min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-8 py-12">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="flex items-center justify-between mb-8">
            <Link href="/community">
              <button className="flex items-center gap-2 text-white/40 hover:text-white text-xs font-mono uppercase tracking-widest transition-colors">
                <ArrowLeft className="w-3.5 h-3.5" /> Community
              </button>
            </Link>
            {isMyPost && (
              <button
                onClick={() => setConfirmDeletePost(true)}
                className="flex items-center gap-1.5 text-white/25 hover:text-red-400 transition-colors text-xs font-mono uppercase tracking-widest"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete Post
              </button>
            )}
          </div>

          <article className="border border-white/10 p-8 mb-12">
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              <span className="text-[9px] font-mono uppercase tracking-widest border border-white/10 px-2 py-0.5 text-white/40">{post.category}</span>
            </div>
            <h1 className="font-serif text-4xl text-white mb-6 leading-tight">{post.title}</h1>
            <div className="flex items-center gap-4 mb-8">
              <img src={post.avatarUrl} alt={post.username} className="w-8 h-8 rounded-full grayscale" />
              <div>
                <p className="text-white text-sm font-medium">{post.username}</p>
                <p className="text-white/30 text-[10px] font-mono">{new Date(post.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
            <div className="border-t border-white/5 pt-8">
              <p className="text-white/75 leading-relaxed whitespace-pre-wrap">{post.content}</p>
            </div>

            {/* GIF display */}
            {post.imageUrl && (
              <div className="mt-8 border border-white/10 overflow-hidden">
                <img
                  src={post.imageUrl}
                  alt=""
                  className="w-full max-h-96 object-contain bg-zinc-950"
                />
              </div>
            )}

            <div className="flex items-center gap-6 mt-8 pt-6 border-t border-white/5 text-xs font-mono text-white/30 uppercase tracking-widest">
              <button
                onClick={handleLike}
                disabled={liked}
                className={`flex items-center gap-1.5 transition-all group ${liked ? "text-white cursor-default" : "hover:text-white/70 cursor-pointer"}`}
                title="Like this post"
              >
                <motion.div
                  animate={liked ? { scale: [1, 1.4, 1] } : {}}
                  transition={{ duration: 0.3 }}
                >
                  <ThumbsUp className={`w-3.5 h-3.5 ${liked ? "fill-white" : "group-hover:fill-white/20"}`} />
                </motion.div>
                {displayLikes}
              </button>
              <span className="flex items-center gap-1.5"><MessageCircle className="w-3 h-3" />{post.commentCount} comments</span>
            </div>
          </article>

          <div>
            <h2 className="font-serif text-2xl text-white mb-6">
              Replies <span className="text-white/30 font-mono text-base font-normal">{comments?.length ?? 0}</span>
            </h2>

            {user ? (
              <div className="border border-white/10 p-5 mb-8 space-y-4">
                <div className="flex items-center gap-2 mb-1">
                  <img src={user.avatarUrl} alt={user.username} className="w-6 h-6 rounded-full grayscale" />
                  <span className="text-white/50 text-xs font-mono">{user.username}</span>
                </div>
                <textarea
                  placeholder="Add a reply..."
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  className="w-full bg-transparent text-white text-sm placeholder:text-white/25 focus:outline-none resize-none border-b border-white/10 pb-2"
                />
                <div className="flex justify-end">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSubmit}
                    disabled={createComment.isPending || !comment.trim()}
                    className="flex items-center gap-2 bg-white text-black px-6 py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-white/90 transition-colors disabled:opacity-40"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {createComment.isPending ? "Posting..." : "Reply"}
                  </motion.button>
                </div>
              </div>
            ) : (
              <div className="border border-white/5 p-5 mb-8 text-center">
                <p className="text-white/30 text-sm">
                  <Link href="/auth" className="text-white/60 hover:text-white underline transition-colors">Sign in</Link> to leave a reply
                </p>
              </div>
            )}

            <div className="space-y-5">
              {comments?.map((c, i) => {
                const isMyComment = !!(user && user.username === c.username);
                return (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="group/comment flex gap-4 border-b border-white/5 pb-5"
                  >
                    <img src={c.avatarUrl} alt={c.username} className="w-8 h-8 rounded-full grayscale flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-white text-sm font-medium">{c.username}</span>
                        <span className="text-white/25 text-[10px] font-mono">{new Date(c.createdAt).toLocaleDateString()}</span>
                        {isMyComment && (
                          <button
                            onClick={() => setConfirmDeleteCommentId(c.id)}
                            className="ml-auto p-1 text-white/20 hover:text-red-400 transition-colors opacity-0 group-hover/comment:opacity-100"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <p className="text-white/70 text-sm leading-relaxed">{c.content}</p>
                      <div className="flex items-center gap-2 mt-3 text-white/25 text-xs font-mono">
                        <ThumbsUp className="w-3 h-3" />{c.likes}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Delete post confirmation */}
      <AnimatePresence>
        {confirmDeletePost && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
            onClick={() => setConfirmDeletePost(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-zinc-950 border border-white/10 p-8 max-w-sm w-full"
            >
              <h3 className="font-serif text-xl text-white mb-2">Delete Post?</h3>
              <p className="text-white/50 text-sm mb-6">This will permanently remove the post and all its replies.</p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setConfirmDeletePost(false)}
                  className="px-5 py-2 text-xs font-mono uppercase tracking-widest text-white/50 hover:text-white border border-white/10 hover:border-white/30 transition-colors">
                  Cancel
                </button>
                <button onClick={handleDeletePost} disabled={deletePost.isPending}
                  className="px-5 py-2 text-xs font-mono uppercase tracking-widest bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50">
                  {deletePost.isPending ? "Deleting…" : "Delete"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete comment confirmation */}
      <AnimatePresence>
        {confirmDeleteCommentId !== null && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
            onClick={() => setConfirmDeleteCommentId(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-zinc-950 border border-white/10 p-8 max-w-sm w-full"
            >
              <h3 className="font-serif text-xl text-white mb-2">Delete Reply?</h3>
              <p className="text-white/50 text-sm mb-6">This will permanently remove your reply.</p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setConfirmDeleteCommentId(null)}
                  className="px-5 py-2 text-xs font-mono uppercase tracking-widest text-white/50 hover:text-white border border-white/10 hover:border-white/30 transition-colors">
                  Cancel
                </button>
                <button onClick={() => handleDeleteComment(confirmDeleteCommentId)} disabled={deleteComment.isPending}
                  className="px-5 py-2 text-xs font-mono uppercase tracking-widest bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50">
                  {deleteComment.isPending ? "Deleting…" : "Delete"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

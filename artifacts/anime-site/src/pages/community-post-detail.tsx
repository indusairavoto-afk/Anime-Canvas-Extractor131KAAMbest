import { motion } from "framer-motion";
import { Link, useParams } from "wouter";
import { useState } from "react";
import { ArrowLeft, ThumbsUp, MessageCircle, Send } from "lucide-react";
import {
  useGetCommunityPost,
  getGetCommunityPostQueryKey,
  useListPostComments,
  getListPostCommentsQueryKey,
  useCreatePostComment,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

export default function CommunityPostDetail() {
  const params = useParams();
  const id = parseInt(params.id ?? "0");
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [comment, setComment] = useState("");

  const { data: post, isLoading } = useGetCommunityPost(id, {
    query: { enabled: !!id, queryKey: getGetCommunityPostQueryKey(id) },
  });
  const { data: comments } = useListPostComments(id, {
    query: { enabled: !!id, queryKey: getListPostCommentsQueryKey(id) },
  });
  const createComment = useCreatePostComment();

  const handleSubmit = () => {
    if (!username.trim() || !comment.trim()) return;
    createComment.mutate(
      { id, data: { username: username.trim(), content: comment.trim() } },
      {
        onSuccess: () => {
          setComment("");
          queryClient.invalidateQueries({ queryKey: getListPostCommentsQueryKey(id) });
        },
      }
    );
  };

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
          <Link href="/community">
            <button className="flex items-center gap-2 text-white/40 hover:text-white text-xs font-mono uppercase tracking-widest transition-colors mb-8" data-testid="button-back">
              <ArrowLeft className="w-3.5 h-3.5" /> Community
            </button>
          </Link>

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
            {post.imageUrl && (
              <img src={post.imageUrl} alt="" className="mt-8 w-full grayscale hover:grayscale-0 transition-all duration-500 border border-white/10" />
            )}
            <div className="flex items-center gap-6 mt-8 pt-6 border-t border-white/5 text-xs font-mono text-white/30 uppercase tracking-widest">
              <span className="flex items-center gap-1.5"><ThumbsUp className="w-3 h-3" />{post.likes}</span>
              <span className="flex items-center gap-1.5"><MessageCircle className="w-3 h-3" />{post.commentCount} comments</span>
            </div>
          </article>

          <div>
            <h2 className="font-serif text-2xl text-white mb-6">
              Replies <span className="text-white/30 font-mono text-base font-normal">{comments?.length ?? 0}</span>
            </h2>

            <div className="border border-white/10 p-5 mb-8 space-y-4">
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-transparent border-b border-white/10 pb-2 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-white/30 transition-colors"
                data-testid="input-username"
              />
              <textarea
                placeholder="Add a reply..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                className="w-full bg-transparent text-white text-sm placeholder:text-white/25 focus:outline-none resize-none"
                data-testid="input-comment"
              />
              <div className="flex justify-end">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSubmit}
                  disabled={createComment.isPending}
                  className="flex items-center gap-2 bg-white text-black px-6 py-2.5 text-xs font-bold uppercase tracking-widest hover:bg-white/90 transition-colors disabled:opacity-40"
                  data-testid="button-submit-comment"
                >
                  <Send className="w-3.5 h-3.5" />
                  {createComment.isPending ? "Posting..." : "Reply"}
                </motion.button>
              </div>
            </div>

            <div className="space-y-5">
              {comments?.map((c, i) => (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex gap-4 border-b border-white/5 pb-5"
                  data-testid={`comment-${c.id}`}
                >
                  <img src={c.avatarUrl} alt={c.username} className="w-8 h-8 rounded-full grayscale flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-white text-sm font-medium">{c.username}</span>
                      <span className="text-white/25 text-[10px] font-mono">{new Date(c.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p className="text-white/70 text-sm leading-relaxed">{c.content}</p>
                    <div className="flex items-center gap-2 mt-3 text-white/25 text-xs font-mono">
                      <ThumbsUp className="w-3 h-3" />{c.likes}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

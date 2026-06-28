import { pgTable, text, serial, integer, real, boolean, pgEnum, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const animeStatusEnum = pgEnum("anime_status", ["ongoing", "completed", "upcoming"]);
export const animeTypeEnum = pgEnum("anime_type", ["sub", "dub", "both"]);
export const episodeTypeEnum = pgEnum("episode_type", ["sub", "dub"]);

export const animeTable = pgTable("anime", {
  id: serial("id").primaryKey(),
  anilistId: integer("anilist_id").unique(),
  title: text("title").notNull(),
  japaneseTitle: text("japanese_title"),
  description: text("description").notNull(),
  coverImage: text("cover_image").notNull(),
  bannerImage: text("banner_image").notNull(),
  trailerUrl: text("trailer_url"),
  genre: text("genre").array().notNull().default([]),
  status: animeStatusEnum("status").notNull().default("ongoing"),
  rating: real("rating").notNull().default(0),
  totalEpisodes: integer("total_episodes").notNull().default(0),
  releaseYear: integer("release_year").notNull(),
  studio: text("studio").notNull(),
  type: animeTypeEnum("type").notNull().default("sub"),
  viewCount: integer("view_count").notNull().default(0),
  isTrending: boolean("is_trending").notNull().default(false),
  isFeatured: boolean("is_featured").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const episodeTable = pgTable("episode", {
  id: serial("id").primaryKey(),
  animeId: integer("anime_id").notNull().references(() => animeTable.id),
  title: text("title").notNull(),
  season: integer("season").notNull().default(1),
  episodeNumber: integer("episode_number").notNull(),
  duration: integer("duration").notNull().default(24),
  description: text("description"),
  thumbnailUrl: text("thumbnail_url").notNull(),
  streamUrl: text("stream_url").notNull(),
  releaseDate: text("release_date").notNull(),
  viewCount: integer("view_count").notNull().default(0),
  type: episodeTypeEnum("type").notNull().default("sub"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const commentTable = pgTable("comment", {
  id: serial("id").primaryKey(),
  episodeId: integer("episode_id").references(() => episodeTable.id),
  communityPostId: integer("community_post_id"),
  username: text("username").notNull(),
  avatarUrl: text("avatar_url").notNull(),
  content: text("content").notNull(),
  likes: integer("likes").notNull().default(0),
  parentId: integer("parent_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const communityPostTable = pgTable("community_post", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  avatarUrl: text("avatar_url").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  category: text("category").notNull(),
  imageUrl: text("image_url"),
  likes: integer("likes").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const reviewRatingEnum = pgEnum("review_rating", ["skip", "timepass", "go_for_it", "perfection"]);

export const reviewTable = pgTable("review", {
  id: serial("id").primaryKey(),
  animeId: integer("anime_id").notNull(),
  episode: integer("episode"),
  username: text("username").notNull(),
  avatarUrl: text("avatar_url").notNull(),
  voterKey: text("voter_key"),
  rating: reviewRatingEnum("rating").notNull(),
  content: text("content").notNull(),
  spoiler: boolean("spoiler").notNull().default(false),
  likes: integer("likes").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const userTable = pgTable("user", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  bio: text("bio"),
  avatarSeed: text("avatar_seed").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const passwordResetTable = pgTable("password_reset", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => userTable.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const magicCodeTable = pgTable("magic_code", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => userTable.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const reviewReplyTable = pgTable("review_reply", {
  id: serial("id").primaryKey(),
  reviewId: integer("review_id").notNull(),
  username: text("username").notNull(),
  avatarUrl: text("avatar_url").notNull(),
  content: text("content").notNull(),
  likes: integer("likes").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const episodeVoteCategoryEnum = pgEnum("episode_vote_category", ["skip", "timepass", "go_for_it", "perfection"]);

export const episodeVoteTable = pgTable("episode_vote", {
  id: serial("id").primaryKey(),
  animeId: text("anime_id").notNull(),
  episode: integer("episode").notNull(),
  category: episodeVoteCategoryEnum("category").notNull(),
  voterKey: text("voter_key").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [unique().on(t.animeId, t.episode, t.voterKey)]);

export type EpisodeVote = typeof episodeVoteTable.$inferSelect;

export const mangaReadStatusEnum = pgEnum("manga_read_status", ["reading", "plan_to_read", "completed"]);

export const watchlistTable = pgTable("watchlist", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => userTable.id, { onDelete: "cascade" }),
  animeId: integer("anime_id").notNull(),
  addedAt: timestamp("added_at").notNull().defaultNow(),
}, (t) => [unique().on(t.userId, t.animeId)]);

export const mangaListTable = pgTable("manga_list", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => userTable.id, { onDelete: "cascade" }),
  mangaId: integer("manga_id").notNull(),
  status: mangaReadStatusEnum("status").notNull().default("plan_to_read"),
  chapter: integer("chapter").notNull().default(0),
  addedAt: timestamp("added_at").notNull().defaultNow(),
}, (t) => [unique().on(t.userId, t.mangaId)]);

export const watchHistoryTable = pgTable("watch_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => userTable.id, { onDelete: "cascade" }),
  animeId: integer("anime_id").notNull(),
  episodeId: integer("episode_id").notNull(),
  episodeNumber: integer("episode_number"),
  animeTitle: text("anime_title"),
  coverImage: text("cover_image"),
  watchedAt: timestamp("watched_at").notNull().defaultNow(),
}, (t) => [unique().on(t.userId, t.episodeId)]);

export const streamReportTable = pgTable("stream_report", {
  id: serial("id").primaryKey(),
  animeId: integer("anime_id").notNull(),
  animeTitle: text("anime_title").notNull(),
  episode: integer("episode").notNull(),
  server: text("server").notNull(),
  lang: text("lang").notNull().default("SUB"),
  gogoSlug: text("gogo_slug"),
  anizoneSlug: text("anizone_slug"),
  kotoSlug: text("koto_slug"),
  miruroUrl: text("miruro_url"),
  reportedAt: timestamp("reported_at").notNull().defaultNow(),
});

export type StreamReport = typeof streamReportTable.$inferSelect;

export const anilistSyncLogTable = pgTable("anilist_sync_log", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  status: text("status").notNull().default("running"),
  upserted: integer("upserted").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  message: text("message"),
});

export type AnilistSyncLog = typeof anilistSyncLogTable.$inferSelect;

export const lnoriMappingTable = pgTable("lnori_mapping", {
  id: serial("id").primaryKey(),
  anilistId: integer("anilist_id").notNull().unique(),
  lnoriUrl: text("lnori_url").notNull(),
  lnoriType: text("lnori_type").notNull().default("series"),
  savedAt: timestamp("saved_at").notNull().defaultNow(),
});

export type LnoriMapping = typeof lnoriMappingTable.$inferSelect;

export const insertAnimeSchema = createInsertSchema(animeTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertEpisodeSchema = createInsertSchema(episodeTable).omit({ id: true, createdAt: true });
export const insertCommentSchema = createInsertSchema(commentTable).omit({ id: true, createdAt: true });
export const insertCommunityPostSchema = createInsertSchema(communityPostTable).omit({ id: true, createdAt: true });
export const insertReviewSchema = createInsertSchema(reviewTable).omit({ id: true, createdAt: true });

export type InsertAnime = z.infer<typeof insertAnimeSchema>;
export type Anime = typeof animeTable.$inferSelect;
export type InsertEpisode = z.infer<typeof insertEpisodeSchema>;
export type Episode = typeof episodeTable.$inferSelect;
export type InsertComment = z.infer<typeof insertCommentSchema>;
export type Comment = typeof commentTable.$inferSelect;
export type InsertCommunityPost = z.infer<typeof insertCommunityPostSchema>;
export type CommunityPost = typeof communityPostTable.$inferSelect;
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviewTable.$inferSelect;

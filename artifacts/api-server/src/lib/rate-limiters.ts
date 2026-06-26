import rateLimit from "express-rate-limit";

const json429 = (_req: any, res: any) =>
  res.status(429).json({ error: "Too many requests — please slow down." });

export const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: json429,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: undefined,
  handler: (_req: any, res: any) =>
    res.status(429).json({ error: "Too many login attempts — try again in 15 minutes." }),
});

export const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: json429,
});

export const voteLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: json429,
});

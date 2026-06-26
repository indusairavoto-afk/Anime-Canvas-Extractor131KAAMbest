import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { userTable, passwordResetTable } from "@workspace/db/schema";
import { eq, or, and, gt, isNull } from "drizzle-orm";
import { authLimiter } from "../lib/rate-limiters";

const router = Router();

function toPublicUser(row: typeof userTable.$inferSelect) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    email: row.email,
    bio: row.bio ?? null,
    avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(row.avatarSeed)}`,
    createdAt: row.createdAt.toISOString(),
  };
}

router.post("/auth/register", authLimiter, async (req, res) => {
  try {
    const { displayName, username, email, password } = req.body;
    if (!displayName || !username || !email || !password) {
      res.status(400).json({ error: "displayName, username, email and password are required" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }
    const uname = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!uname) {
      res.status(400).json({ error: "Invalid username" });
      return;
    }
    const existing = await db.select().from(userTable).where(
      or(eq(userTable.username, uname), eq(userTable.email, email.trim().toLowerCase()))
    ).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "Username or email already taken" });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const [row] = await db.insert(userTable).values({
      username: uname,
      displayName: displayName.trim(),
      email: email.trim().toLowerCase(),
      passwordHash,
      avatarSeed: uname,
    }).returning();
    res.status(201).json(toPublicUser(row));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) { res.status(400).json({ error: "email is required" }); return; }

    const [user] = await db.select().from(userTable)
      .where(eq(userTable.email, email.trim().toLowerCase())).limit(1);

    if (!user) {
      res.status(404).json({ error: "No account found with that email" });
      return;
    }

    const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_!@#$%&";
    const bytes = crypto.randomBytes(30);
    const token = Array.from(bytes).map(b => charset[b % charset.length]).join("");

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insert(passwordResetTable).values({ userId: user.id, token, expiresAt });

    res.json({ token, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) { res.status(400).json({ error: "token and password are required" }); return; }
    if (password.length < 6) { res.status(400).json({ error: "Password must be at least 6 characters" }); return; }

    const [reset] = await db.select().from(passwordResetTable)
      .where(and(
        eq(passwordResetTable.token, token),
        isNull(passwordResetTable.usedAt),
        gt(passwordResetTable.expiresAt, new Date()),
      )).limit(1);

    if (!reset) {
      res.status(400).json({ error: "Reset link is invalid or has expired" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await db.update(userTable).set({ passwordHash }).where(eq(userTable.id, reset.userId));
    await db.update(passwordResetTable).set({ usedAt: new Date() }).where(eq(passwordResetTable.id, reset.id));

    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/auth/me", async (req, res) => {
  try {
    const id = parseInt(req.query.id as string);
    if (!id || isNaN(id)) { res.status(401).json({ error: "Unauthorized" }); return; }
    const [row] = await db.select().from(userTable).where(eq(userTable.id, id)).limit(1);
    if (!row) { res.status(401).json({ error: "User not found" }); return; }
    res.json(toPublicUser(row));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/login", authLimiter, async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;
    if (!emailOrUsername || !password) {
      res.status(400).json({ error: "emailOrUsername and password are required" });
      return;
    }
    const identifier = emailOrUsername.trim().toLowerCase();
    const [row] = await db.select().from(userTable).where(
      or(eq(userTable.email, identifier), eq(userTable.username, identifier))
    ).limit(1);
    if (!row) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const valid = await bcrypt.compare(password, row.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    res.json(toPublicUser(row));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

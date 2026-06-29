import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { userTable, passwordResetTable, magicCodeTable, accountRecoveryTable } from "@workspace/db/schema";
import { eq, or, and, gt, isNull } from "drizzle-orm";
import { authLimiter } from "../lib/rate-limiters";
import {
  sendMagicCodeEmail,
  sendPasswordResetEmail,
} from "../lib/mailer";

const router = Router();

function getBaseUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) ?? req.protocol ?? "https";
  const host = req.headers["x-forwarded-host"] as string ?? req.headers.host ?? "localhost:5000";
  return `${proto}://${host}`;
}

function toPublicUser(row: typeof userTable.$inferSelect) {
  let avatarUrl: string;
  if (row.avatarSeed.startsWith("lorelei:")) {
    const seed = row.avatarSeed.slice("lorelei:".length);
    avatarUrl = `https://api.dicebear.com/9.x/lorelei/svg?seed=${encodeURIComponent(seed)}&backgroundColor=transparent`;
  } else {
    avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(row.avatarSeed)}`;
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    email: row.email,
    bio: row.bio ?? null,
    avatarUrl,
    emailVerified: row.emailVerified,
    createdAt: row.createdAt.toISOString(),
  };
}

function generateBackupCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(16);
  const raw = Array.from(bytes).map(b => chars[b % chars.length]).join("");
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
}

// ── Register ────────────────────────────────────────────────────────────────

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
    const rows = await db.insert(userTable).values({
      username: uname,
      displayName: displayName.trim(),
      email: email.trim().toLowerCase(),
      passwordHash,
      avatarSeed: uname,
      emailVerified: true,
    }).returning();

    const row = rows[0];
    if (!row) {
      res.status(500).json({ error: "Account creation failed — please try again" });
      return;
    }

    // Generate a backup recovery code — store hash, return plaintext once
    const backupCode = generateBackupCode();
    const codeHash = await bcrypt.hash(backupCode, 10);
    await db.insert(accountRecoveryTable).values({ userId: row.id, codeHash });

    res.status(201).json({ ...toPublicUser(row), backupCode });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Account Recovery (backup code) ──────────────────────────────────────────

router.post("/auth/recover", authLimiter, async (req, res) => {
  try {
    const { emailOrUsername, backupCode } = req.body;
    if (!emailOrUsername || !backupCode) {
      res.status(400).json({ error: "emailOrUsername and backupCode are required" });
      return;
    }
    const identifier = emailOrUsername.trim().toLowerCase();
    const [user] = await db.select().from(userTable).where(
      or(eq(userTable.email, identifier), eq(userTable.username, identifier))
    ).limit(1);

    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const [recovery] = await db.select().from(accountRecoveryTable)
      .where(eq(accountRecoveryTable.userId, user.id)).limit(1);

    if (!recovery) {
      res.status(401).json({ error: "No backup code found for this account" });
      return;
    }

    const normalised = backupCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const stored = recovery.codeHash;
    const valid = await bcrypt.compare(
      `${normalised.slice(0, 5)}-${normalised.slice(5, 10)}-${normalised.slice(10, 15)}-${normalised.slice(15, 20)}`,
      stored
    );
    if (!valid) {
      res.status(401).json({ error: "Invalid backup code" });
      return;
    }

    // Rotate — generate a new backup code so old one can't be reused
    const newCode = generateBackupCode();
    const newHash = await bcrypt.hash(newCode, 10);
    await db.update(accountRecoveryTable).set({ codeHash: newHash, createdAt: new Date() })
      .where(eq(accountRecoveryTable.id, recovery.id));

    res.json({ ...toPublicUser(user), newBackupCode: newCode });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Forgot / Reset Password ─────────────────────────────────────────────────

router.post("/auth/forgot-password", authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) { res.status(400).json({ error: "email is required" }); return; }

    const [user] = await db.select().from(userTable)
      .where(eq(userTable.email, email.trim().toLowerCase())).limit(1);

    if (!user) {
      res.json({ ok: true });
      return;
    }

    const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const bytes = crypto.randomBytes(30);
    const token = Array.from(bytes).map(b => charset[b % charset.length]).join("");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.insert(passwordResetTable).values({ userId: user.id, token, expiresAt });
    await sendPasswordResetEmail(user.email, user.displayName, token, getBaseUrl(req));

    res.json({ ok: true });
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

// ── Auth me / Login ─────────────────────────────────────────────────────────

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

// ── Magic Code (passwordless login) ────────────────────────────────────────

router.post("/auth/magic-code/request", authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) { res.status(400).json({ error: "email is required" }); return; }

    const [user] = await db.select().from(userTable)
      .where(eq(userTable.email, email.trim().toLowerCase())).limit(1);
    if (!user) {
      res.status(404).json({ error: "No account found with that email" });
      return;
    }

    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.randomBytes(8);
    const code = Array.from(bytes).map(b => chars[b % chars.length]).join("");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.insert(magicCodeTable).values({ userId: user.id, code, expiresAt });
    await sendMagicCodeEmail(user.email, user.displayName, code);

    res.json({ ok: true, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/magic-code/verify", authLimiter, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) { res.status(400).json({ error: "code is required" }); return; }

    const [record] = await db.select().from(magicCodeTable)
      .where(and(
        eq(magicCodeTable.code, code.trim().toUpperCase()),
        isNull(magicCodeTable.usedAt),
        gt(magicCodeTable.expiresAt, new Date()),
      )).limit(1);

    if (!record) {
      res.status(400).json({ error: "Invalid or expired code" });
      return;
    }

    await db.update(magicCodeTable).set({ usedAt: new Date() }).where(eq(magicCodeTable.id, record.id));

    const [user] = await db.select().from(userTable).where(eq(userTable.id, record.userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    res.json(toPublicUser(user));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/auth/avatar", async (req, res) => {
  try {
    const { userId, seed } = req.body as { userId?: unknown; seed?: unknown };
    if (!userId || !seed || typeof seed !== "string") {
      res.status(400).json({ error: "userId and seed are required" });
      return;
    }
    if (!seed.startsWith("lorelei:") || seed.length <= "lorelei:".length) {
      res.status(400).json({ error: "Invalid seed format" });
      return;
    }
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }
    await db.update(userTable).set({ avatarSeed: seed }).where(eq(userTable.id, uid));
    const [row] = await db.select().from(userTable).where(eq(userTable.id, uid)).limit(1);
    if (!row) { res.status(404).json({ error: "User not found" }); return; }
    res.json(toPublicUser(row));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

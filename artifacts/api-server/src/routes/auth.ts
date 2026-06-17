import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { userTable } from "@workspace/db/schema";
import { eq, or } from "drizzle-orm";

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

router.post("/auth/register", async (req, res) => {
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

router.post("/auth/login", async (req, res) => {
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

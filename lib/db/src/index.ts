import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Determine SSL config from the URL itself rather than guessing from NODE_ENV.
// - If the URL already has sslmode=disable → no SSL.
// - If the URL has sslmode=require / render.com / supabase → SSL without cert validation.
// - If NODE_ENV is production and no explicit mode → SSL without cert validation (safe default).
// - Otherwise (local dev) → no SSL.
function getSsl(url: string): boolean | { rejectUnauthorized: boolean } {
  if (url.includes("sslmode=disable")) return false;
  if (
    url.includes("sslmode=require") ||
    url.includes("sslmode=no-verify") ||
    url.includes(".render.com") ||
    url.includes("supabase")
  ) {
    return { rejectUnauthorized: false };
  }
  if (process.env.NODE_ENV === "production") {
    return { rejectUnauthorized: false };
  }
  return false;
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: getSsl(process.env.DATABASE_URL),
});

export const db = drizzle(pool, { schema });

export * from "./schema";

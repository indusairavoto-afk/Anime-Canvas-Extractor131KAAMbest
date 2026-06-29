import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const dbUrl = process.env.DATABASE_URL;

// Render internal hostnames (dpg-*) and external Render/Supabase URLs need SSL.
// Append sslmode=no-verify so drizzle-kit connects successfully without cert validation.
function withSsl(url: string): string {
  if (url.includes("sslmode=")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}sslmode=no-verify`;
}

const connectionUrl =
  process.env.NODE_ENV === "production" ? withSsl(dbUrl) : dbUrl;

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: connectionUrl,
  },
});

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __lifemaxxSql: ReturnType<typeof postgres> | undefined;
}

function connection() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  // Reuse across hot reloads; Supabase's pooler has a modest connection cap.
  if (!globalThis.__lifemaxxSql) {
    globalThis.__lifemaxxSql = postgres(url, { prepare: false, max: 5 });
  }
  return globalThis.__lifemaxxSql;
}

export const db = drizzle(connection(), { schema });
export { schema };

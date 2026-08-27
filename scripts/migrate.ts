import "../load-env";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

/**
 * Applies drizzle/*.sql in order, tracked in `drizzle.__drizzle_migrations`.
 *
 * This replaces `drizzle-kit push`, which was the wrong tool twice over: it
 * diffs the TypeScript schema against the live database and never looks at the
 * SQL folder, so `CREATE EXTENSION pg_trgm` and every RLS policy — neither of
 * which exists in schema.ts — were silently skipped. The first symptom was a
 * runtime `function similarity(text, text) does not exist` on the first typo'd
 * exercise name. Push is also destructive by design; migrations are reviewable
 * and replayable.
 *
 * Runs on its own single connection: the migrator wraps everything in one
 * transaction and must not share the app's pool.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");

  const sql = postgres(url, { max: 1, prepare: false });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

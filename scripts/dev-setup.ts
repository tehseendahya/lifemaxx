import "../load-env";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { DEMO_USER } from "./seed-demo";

/**
 * Everything needed to get `npm run dev` showing a working app, in one command.
 *
 * Without a reachable Supabase there is no magic-link sign-in, so every screen
 * redirects to /login and there is nothing to look at. This creates the schema,
 * loads the exercise catalogue, writes a month of demo data and points
 * DEV_USER_ID at it — which is the only combination that produces a running
 * app on a laptop with a local Postgres and nothing else.
 *
 *   npm run dev:setup && npm run dev
 */

const step = (msg: string) => console.log(`\n\x1b[1m${msg}\x1b[0m`);
const run = (args: string[]) =>
  execFileSync("npx", args, { stdio: "inherit", env: process.env });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(`
DATABASE_URL is not set.

Copy .env.example to .env.local and point DATABASE_URL at a Postgres you can
reach. If you don't have one:

  docker run -d --name lifemaxx-pg -p 5432:5432 \\
    -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=lifemaxx postgres:16

  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/lifemaxx
`);
    process.exit(1);
  }

  step("Checking the database is reachable…");
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });
  try {
    const [row] = await sql`select current_database() as db, version() as version`;
    console.log(`  ${row.db} — ${String(row.version).split(",")[0]}`);
  } catch (err) {
    console.error(`\nCould not connect to DATABASE_URL.\n  ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  } finally {
    await sql.end();
  }

  step("Applying migrations…");
  run(["tsx", "scripts/migrate.ts"]);

  step("Loading the exercise catalogue…");
  run(["tsx", "src/db/seed.ts"]);

  step("Writing demo data…");
  run(["tsx", "scripts/seed-demo.ts"]);

  step("Pointing DEV_USER_ID at the demo user…");
  const envPath = ".env.local";
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  if (current.includes("DEV_USER_ID=")) {
    console.log("  already set in .env.local, leaving it alone");
  } else {
    const prefix = current.length && !current.endsWith("\n") ? "\n" : "";
    writeFileSync(
      envPath,
      `${current}${prefix}\n# Development only. Inert unless set, and disabled in production builds.\nDEV_USER_ID=${DEMO_USER}\n`,
    );
    console.log(`  DEV_USER_ID=${DEMO_USER}`);
  }

  step("Done. Start it with:");
  console.log("\n  npm run dev\n");
  console.log("Then open http://localhost:3000 — signed in as the demo user.\n");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });

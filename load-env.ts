import { config } from "dotenv";

/**
 * Next.js loads `.env.local` ahead of `.env`; the CLI scripts (drizzle-kit,
 * the seeder) do not, so following the README — credentials in `.env.local` —
 * left `npm run db:push` and `npm run db:seed` staring at an empty
 * DATABASE_URL. Load the same files, in the same order, before anything reads
 * process.env.
 *
 * `override: false` is the default and is what makes precedence work: the
 * first file to define a key wins, and a real environment variable (Vercel,
 * CI, an exported shell var) beats both.
 */
for (const path of [".env.local", ".env"]) config({ path, quiet: true });

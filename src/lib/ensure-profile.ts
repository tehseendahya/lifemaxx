import { db } from "@/db";
import { profiles } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Creates the profile row the rest of the app hangs off, once per user.
 *
 * Every screen, every query helper and the cron jobs that enumerate users all
 * read `profiles` — a signed-in user without a row here is authenticated but
 * invisible, which looks like a broken app rather than a missing insert.
 *
 * Magic-link sign-in got this for free because the redirect passed through
 * /auth/callback. Password sign-in never touches that route: the session is
 * established client-side by GoTrue and the browser goes straight to the app.
 * So both paths call this instead of one of them relying on a redirect.
 *
 * Runs unscoped on purpose — this is the row that RLS policies are keyed on,
 * so it cannot be written from inside a scope that filters by its own absence.
 * Idempotent: a second call on an existing profile is a no-op, never an
 * overwrite of settings the user has since changed.
 */
export async function ensureProfile(id: string, email: string): Promise<void> {
  const existing = await db.select({ id: profiles.id })
    .from(profiles).where(eq(profiles.id, id)).limit(1);
  if (existing.length > 0) return;

  await db.insert(profiles)
    .values({ id, email })
    // Two tabs finishing sign-in together would otherwise race to insert the
    // same primary key and surface as a 500 on whichever lost.
    .onConflictDoNothing({ target: profiles.id });
}

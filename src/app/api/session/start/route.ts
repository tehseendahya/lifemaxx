import { route } from "@/lib/api";
import { db } from "@/db";
import { workouts } from "@/db/schema";
import { getActiveWorkout, latestBodyweightKg } from "@/lib/queries";
import { closeStaleSession } from "@/lib/sessions";

/**
 * Starting a session creates the row immediately with status 'active'.
 *
 * This is the durability split: the session exists in Postgres from the first
 * tap, and every set persists as it's saved. Stop Lift only flips the status
 * and computes the name. A dead phone at exercise four resumes instead of
 * losing the whole workout.
 *
 * ── RESUMING IS NOW BOUNDED ────────────────────────────────────────────────
 *
 * It used to be unbounded, and that was the bug behind "it combined all my
 * stuff into one lift". `getActiveWorkout` returned ANY row left in
 * `status = 'active'`, with no time limit at all, so a session walked away
 * from yesterday was resumed today and the whole second day was written into
 * it — under the first day's `localDate`.
 *
 * Resuming is still the right default for the case it was built for, which is
 * a dead phone or a crash mid-session. The difference is that it now only
 * happens while the session is actually live; `domain/session.ts` holds the
 * rule. The stale one is closed first, so it lands in the history with a real
 * end time and a derived name instead of lingering open.
 */
export const POST = route<{ gymId?: string | null }>(async ({ userId, today, body }) => {
  await closeStaleSession(userId);

  const existing = await getActiveWorkout(userId);
  if (existing) return { workout: existing, resumed: true };

  const [workout] = await db.insert(workouts).values({
    userId,
    gymId: body.gymId ?? null,
    status: "active",
    localDate: today,
    bodyweightKg: await latestBodyweightKg(userId),
  }).returning();

  return { workout, resumed: false };
});

import { route } from "@/lib/api";
import { db } from "@/db";
import { workouts } from "@/db/schema";
import { getActiveWorkout, latestBodyweightKg } from "@/lib/queries";

/**
 * Starting a session creates the row immediately with status 'active'.
 *
 * This is the durability split: the session exists in Postgres from the first
 * tap, and every set persists as it's saved. Stop Lift only flips the status
 * and computes the name. A dead phone at exercise four resumes instead of
 * losing the whole workout.
 */
export const POST = route<{ gymId?: string | null }>(async ({ userId, today, body }) => {
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

import { db } from "@/db";
import { workouts, sets, exerciseMuscles } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { deriveWorkoutName, type CountedSet } from "./domain/muscles";
import { impliedEndedAt, sessionEndedBy } from "./domain/session";
import { activityOf } from "./queries";

/**
 * Closing a session nobody stopped.
 *
 * `getActiveWorkout` already refuses to hand out a session that has gone idle
 * past the threshold, so nothing can be written into one by the time this runs
 * — this is the housekeeping that follows: give the row an end time and a
 * name, so it reads as a finished workout in the history rather than as a
 * session that is somehow still going from two weeks ago.
 *
 * It is a separate call rather than something `getActiveWorkout` does, because
 * a read that quietly writes is a read nobody can reason about: it would fire
 * from the dashboard, from the coach, from a cron enumerating every user, and
 * from four routes that only wanted to know whether to draw a START button.
 * The write paths call this; the reads stay reads.
 *
 * Idempotent, and safe to call when there is nothing to do.
 */
export async function closeStaleSession(userId: string, at: Date = new Date()): Promise<void> {
  const [open] = await db.select().from(workouts)
    .where(and(eq(workouts.userId, userId), eq(workouts.status, "active")))
    .limit(1);
  if (!open) return;

  const activity = await activityOf(open);
  if (!sessionEndedBy(activity, at)) return;

  const rows = await db
    .select({
      isWarmup: sets.isWarmup,
      muscle: exerciseMuscles.muscle,
      contribution: exerciseMuscles.contribution,
    })
    .from(sets)
    .leftJoin(exerciseMuscles, eq(exerciseMuscles.exerciseId, sets.exerciseId))
    .where(eq(sets.workoutId, open.id));

  /*
   * An empty session is a mistake rather than a workout — the same call STOP
   * makes. Someone tapped START, got distracted, and left; keeping that as a
   * named entry in the history is worse than binning it.
   */
  if (rows.length === 0) {
    await db.update(workouts)
      .set({ status: "abandoned", endedAt: impliedEndedAt(activity) })
      .where(and(eq(workouts.id, open.id), eq(workouts.userId, userId)));
    return;
  }

  const counted: CountedSet[] = rows
    .filter((r) => r.muscle)
    .map((r) => ({
      isWarmup: r.isWarmup,
      muscles: [{ muscle: r.muscle!, contribution: r.contribution! }],
    }));

  await db.update(workouts).set({
    status: "completed",
    /*
     * The last set, not now. This is the difference between the history
     * reading "Chest & Biceps · 75 min" and "Chest & Biceps · 1,387 min" for a
     * session that was simply walked away from, and the wrong figure would
     * feed every duration the app ever shows for it.
     */
    endedAt: impliedEndedAt(activity),
    name: deriveWorkoutName(counted),
    // Never `true`: the owner did not type this name, the app inferred it, and
    // claiming otherwise would stop a later rename from being offered.
    nameIsCustom: false,
  }).where(and(eq(workouts.id, open.id), eq(workouts.userId, userId)));
}

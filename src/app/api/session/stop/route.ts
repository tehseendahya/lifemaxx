import { route } from "@/lib/api";
import { db } from "@/db";
import { workouts, sets, exerciseMuscles } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { deriveWorkoutName, hardSetsByMuscle, muscleLabel, type CountedSet } from "@/lib/domain/muscles";
import { totalVolumeKg } from "@/lib/domain/e1rm";
import { getActiveWorkout } from "@/lib/queries";

export const POST = route<{ name?: string }>(async ({ userId, body }) => {
  const active = await getActiveWorkout(userId);
  if (!active) throw new Error("No active session.");

  const rows = await db
    .select({
      isWarmup: sets.isWarmup, reps: sets.reps, weightKg: sets.weightKg,
      muscle: exerciseMuscles.muscle, contribution: exerciseMuscles.contribution,
    })
    .from(sets)
    .leftJoin(exerciseMuscles, eq(exerciseMuscles.exerciseId, sets.exerciseId))
    .where(eq(sets.workoutId, active.id));

  // An empty session is a mistake, not a workout — bin it rather than keep it.
  if (rows.length === 0) {
    await db.update(workouts).set({ status: "abandoned", endedAt: new Date() })
      .where(eq(workouts.id, active.id));
    return { workout: null, discarded: true };
  }

  const counted: CountedSet[] = rows
    .filter((r) => r.muscle)
    .map((r) => ({ isWarmup: r.isWarmup, muscles: [{ muscle: r.muscle!, contribution: r.contribution! }] }));

  const name = body.name?.trim() || deriveWorkoutName(counted);

  const [workout] = await db.update(workouts).set({
    status: "completed",
    endedAt: new Date(),
    name,
    nameIsCustom: Boolean(body.name?.trim()),
  }).where(and(eq(workouts.id, active.id), eq(workouts.userId, userId))).returning();

  const volume = hardSetsByMuscle(counted);
  const durationMin = workout.endedAt && workout.startedAt
    ? Math.round((+workout.endedAt - +workout.startedAt) / 60000)
    : 0;

  return {
    workout,
    summary: {
      durationMin,
      totalSets: rows.filter((r) => !r.isWarmup).length,
      volumeKg: totalVolumeKg(rows.map((r) => ({ reps: r.reps, weightKg: r.weightKg, isWarmup: r.isWarmup }))),
      muscles: [...volume.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([m, v]) => ({ muscle: m, label: muscleLabel(m), sets: Math.round(v * 10) / 10 })),
    },
  };
});

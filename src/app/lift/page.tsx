import { currentUserId } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { exercises } from "@/db/schema";
import { isNull, or, eq, asc } from "drizzle-orm";
import { getProfile, localDate, getActiveWorkout, getWorkoutSets, getGyms, getMuscleVolume } from "@/lib/queries";
import { displayLb } from "@/lib/domain/units";
import { LiftClient } from "./LiftClient";

export const dynamic = "force-dynamic";

export default async function Lift() {
  const userId = await currentUserId();
  if (!userId) redirect("/login");

  const profile = await getProfile(userId);
  const today = localDate(profile?.tz ?? "America/New_York");

  const [active, gymList, volume, catalogue] = await Promise.all([
    getActiveWorkout(userId),
    getGyms(userId),
    getMuscleVolume(userId, today),
    db.select({ id: exercises.id, name: exercises.name, slug: exercises.slug })
      .from(exercises)
      .where(or(isNull(exercises.userId), eq(exercises.userId, userId)))
      .orderBy(asc(exercises.name)),
  ]);

  const sets = active ? await getWorkoutSets(active.id) : [];

  return (
    <LiftClient
      active={active ? { id: active.id, startedAt: active.startedAt.toISOString() } : null}
      sets={sets.map((s) => ({
        id: s.id, exerciseId: s.exerciseId, exerciseName: s.exerciseName,
        reps: s.reps, weightLb: displayLb(s.weightKg), rpe: s.rpe,
        toFailure: s.toFailure, isWarmup: s.isWarmup, felt: s.felt,
      }))}
      gyms={gymList.map((g) => ({ id: g.id, name: g.name }))}
      catalogue={catalogue}
      due={volume.ranked.filter((r) => r.score > 0.2).slice(0, 3).map((r) => r.label)}
    />
  );
}

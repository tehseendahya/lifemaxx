import { currentUserId } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { db, withUser } from "@/db";
import { exercises } from "@/db/schema";
import { isNull, or, eq, asc } from "drizzle-orm";
import { getProfile, localDate, getActiveWorkout, getWorkoutSets, getGyms, getMuscleVolume } from "@/lib/queries";
import { displayLb } from "@/lib/domain/units";
import { LiftClient } from "./LiftClient";

export const dynamic = "force-dynamic";

export default async function Lift() {
  const userId = await currentUserId();
  if (!userId) redirect("/login");

  // Read inside a user scope, so the RLS policies do the filtering here the
  // same way they do in the API routes. See withUser() in src/db/index.ts.
  const { active, gymList, volume, catalogue, sets } = await withUser(userId, async () => {
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

    return { active, gymList, volume, catalogue, sets: active ? await getWorkoutSets(active.id) : [] };
  });

  return (
    <LiftClient
      active={active ? { id: active.id, startedAt: active.startedAt.toISOString() } : null}
      sets={sets.map((s) => ({
        id: s.id, clientId: s.clientId, exerciseId: s.exerciseId, exerciseName: s.exerciseName,
        reps: s.reps, weightLb: displayLb(s.weightKg), rpe: s.rpe,
        toFailure: s.toFailure, isWarmup: s.isWarmup, felt: s.felt,
      }))}
      gyms={gymList.map((g) => ({ id: g.id, name: g.name }))}
      catalogue={catalogue}
      due={volume.ranked.filter((r) => r.score > 0.2).slice(0, 3).map((r) => r.label)}
    />
  );
}

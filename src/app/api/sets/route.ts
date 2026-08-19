import { route } from "@/lib/api";
import { db } from "@/db";
import { sets, workouts } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { lbToKg } from "@/lib/domain/units";
import { getActiveWorkout } from "@/lib/queries";

interface Body {
  exerciseId: string;
  reps: number;
  weightLb: number;
  rpe?: number | null;
  toFailure?: boolean;
  isWarmup?: boolean;
  felt?: "weak" | "normal" | "strong" | null;
  note?: string;
  rawText?: string;
}

export const POST = route<Body>(async ({ userId, body }) => {
  const active = await getActiveWorkout(userId);
  if (!active) throw new Error("Start a session first.");

  const prior = await db.select({ loggedAt: sets.loggedAt, setIndex: sets.setIndex })
    .from(sets).where(eq(sets.workoutId, active.id))
    .orderBy(desc(sets.loggedAt)).limit(1);

  // Rest is measured from the gap since the last save. Free data — the user is
  // already tapping — and it feeds whether the next set should go up.
  const restS = prior.length
    ? Math.min(3600, Math.round((Date.now() - +prior[0].loggedAt) / 1000))
    : null;

  const [row] = await db.insert(sets).values({
    workoutId: active.id,
    exerciseId: body.exerciseId,
    setIndex: (prior[0]?.setIndex ?? 0) + 1,
    reps: body.reps,
    weightKg: lbToKg(body.weightLb),
    rpe: body.rpe ?? null,
    toFailure: body.toFailure ?? false,
    isWarmup: body.isWarmup ?? false,
    restS,
    felt: body.felt ?? null,
    note: body.note ?? "",
    rawText: body.rawText ?? "",
  }).returning();

  return { set: row };
});

export const DELETE = route<{ id: string }>(async ({ userId, body }) => {
  const active = await getActiveWorkout(userId);
  if (!active) throw new Error("No active session.");
  await db.delete(sets).where(and(eq(sets.id, body.id), eq(sets.workoutId, active.id)));
  return { ok: true };
});

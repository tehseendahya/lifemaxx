import { route, HttpError } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { db } from "@/db";
import { exerciseMuscles, exercises, sets, workouts } from "@/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { getActiveWorkout } from "@/lib/queries";
import { deriveWorkoutName } from "@/lib/domain/muscles";
import { displayLb, lbToKg } from "@/lib/domain/units";
import {
  countedSets, editableReason, nextSetPosition, parseSetDelete, parseSetWrite,
} from "@/lib/workout-edit";

/**
 * Editing, adding and removing sets in a workout that is OVER.
 *
 * The owner's ask: open last Tuesday, fix the 155 that should have been 165,
 * add the lateral raises that never got logged, delete a set logged twice.
 * Why this is its own route rather than a mode of `POST /api/sets` is in
 * `lib/workout-edit.ts`; the short version is that `/api/sets` chooses its
 * workout by time for the outbox's sake and must keep doing only that.
 *
 * Every write here is a direct call from the phone, never the outbox. The
 * outbox is the live session's pipe; a past-workout edit offline fails in its
 * sheet with the reason and nothing is queued.
 *
 * Both methods share the same three refusals, in `editableWorkout`: a workout
 * that is not the caller's (404), the session still running (409), anything
 * not completed (409).
 */

interface EditableWorkout {
  id: string;
  name: string;
  nameIsCustom: boolean;
  status: string;
  startedAt: Date;
}

async function editableWorkout(userId: string, workoutId: string): Promise<EditableWorkout> {
  // Scoped by user as well as by id. RLS already guarantees it; this keeps
  // someone else's id a 404 rather than an empty write that answers 200.
  const [workout] = await db
    .select({
      id: workouts.id,
      name: workouts.name,
      nameIsCustom: workouts.nameIsCustom,
      status: workouts.status,
      startedAt: workouts.startedAt,
    })
    .from(workouts)
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))
    .limit(1);

  const live = await getActiveWorkout(userId);
  const refusal = editableReason(workout ?? null, live?.id ?? null);
  if (refusal !== null) throw new HttpError(refusal.message, refusal.status);
  return workout;
}

/**
 * The derived name, brought up to date with what the workout now holds.
 *
 * Adding lateral raises to a "Chest & Triceps" day can make it a "Push" day,
 * and it should say so — the same derivation STOP ran when it closed. A name
 * the owner TYPED is never touched: `nameIsCustom` is the record that they
 * chose it, and a set edit is not a reason to overrule them.
 */
async function rederiveName(workout: EditableWorkout, userId: string): Promise<string> {
  if (workout.nameIsCustom) return workout.name;

  const rows = await db
    .select({
      isWarmup: sets.isWarmup,
      muscle: exerciseMuscles.muscle,
      contribution: exerciseMuscles.contribution,
    })
    .from(sets)
    .leftJoin(exerciseMuscles, eq(exerciseMuscles.exerciseId, sets.exerciseId))
    .where(eq(sets.workoutId, workout.id));

  const name = deriveWorkoutName(countedSets(rows));
  if (name !== workout.name) {
    await db.update(workouts).set({ name })
      .where(and(eq(workouts.id, workout.id), eq(workouts.userId, userId)));
  }
  return name;
}

type SetRow = typeof sets.$inferSelect;

const setDto = (row: SetRow) => ({
  id: row.id,
  exerciseId: row.exerciseId,
  setIndex: row.setIndex,
  reps: row.reps,
  weightLb: displayLb(row.weightKg),
  rpe: row.rpe,
  toFailure: row.toFailure,
  isWarmup: row.isWarmup,
  loggedAt: row.loggedAt.toISOString(),
});

/**
 * `{ workoutId, id?, exerciseId, reps, weightLb, rpe?, toFailure?, isWarmup? }`
 *
 * With `id`, an UPDATE of the figures. Without, a new set at the end.
 */
export const POST = route(async ({ userId, body }) => {
  const parsed = parseSetWrite(body);
  if (!parsed.ok) throw new HttpError(parsed.error);
  const input = parsed.value;

  const workout = await editableWorkout(userId, input.workoutId);

  let row: SetRow | undefined;

  if (input.id !== undefined) {
    /*
     * Scoped by the set AND the workout. The workout was just proven to be the
     * caller's; the set id was not. Without the second condition a set id
     * from any workout at all — including the live one this route refuses —
     * would be updated through a workout that merely passed the checks.
     *
     * Only the figures change. `exerciseId`, `setIndex`, `loggedAt` and
     * `restS` keep what the session recorded: a fixed weight is the same set,
     * in the same place, after the same rest. A field the body omits is left
     * alone, the rule `/api/sets` follows for corrections.
     */
    [row] = await db.update(sets).set({
      reps: input.reps,
      weightKg: lbToKg(input.weightLb),
      ...(input.rpe !== undefined ? { rpe: input.rpe } : {}),
      ...(input.toFailure !== undefined ? { toFailure: input.toFailure } : {}),
      ...(input.isWarmup !== undefined ? { isWarmup: input.isWarmup } : {}),
    })
      .where(and(eq(sets.id, input.id), eq(sets.workoutId, workout.id)))
      .returning();

    if (row === undefined) throw new HttpError("Unknown set.", 404);
  } else {
    const exerciseId = input.exerciseId as string;

    // A built-in lift or one of the caller's own. The foreign key alone would
    // accept another user's custom exercise id, because constraints do not
    // run through RLS.
    const [exercise] = await db.select({ id: exercises.id }).from(exercises)
      .where(and(
        eq(exercises.id, exerciseId),
        or(isNull(exercises.userId), eq(exercises.userId, userId)),
      ))
      .limit(1);
    if (exercise === undefined) throw new HttpError("Unknown exercise.");

    const existing = await db.select({ setIndex: sets.setIndex, loggedAt: sets.loggedAt })
      .from(sets).where(eq(sets.workoutId, workout.id));
    const position = nextSetPosition(existing, workout.startedAt);

    [row] = await db.insert(sets).values({
      workoutId: workout.id,
      exerciseId,
      setIndex: position.setIndex,
      reps: input.reps,
      weightKg: lbToKg(input.weightLb),
      rpe: input.rpe ?? null,
      toFailure: input.toFailure ?? false,
      isWarmup: input.isWarmup ?? false,
      // No rest was measured for a set typed in after the fact, and no client
      // id: this row is not the outbox's, and must never match one of its
      // `(workout_id, client_id)` upserts.
      restS: null,
      clientId: null,
      loggedAt: position.loggedAt,
    }).returning();
  }

  const workoutName = await rederiveName(workout, userId);
  return { set: setDto(row), workoutName };
});

/**
 * `{ workoutId, id }`. A body on a DELETE, unlike `DELETE /api/mobile/workout`:
 * this one needs two ids and mirrors `DELETE /api/sets`, which the phone
 * already sends a body to.
 *
 * Removing the last set removes the workout. A workout of no sets is the thing
 * STOP refuses to keep ("an empty session is a mistake, not a workout"), and
 * leaving one behind would put a nameless zero-set row in the history.
 */
export const DELETE = route(async ({ userId, body }) => {
  const parsed = parseSetDelete(body);
  if (!parsed.ok) throw new HttpError(parsed.error);
  const { workoutId, id } = parsed.value;

  const workout = await editableWorkout(userId, workoutId);

  const deleted = await db.delete(sets)
    .where(and(eq(sets.id, id), eq(sets.workoutId, workout.id)))
    .returning({ id: sets.id });
  if (deleted.length === 0) throw new HttpError("Unknown set.", 404);

  const remaining = await db.select({ id: sets.id }).from(sets)
    .where(eq(sets.workoutId, workout.id))
    .limit(1);

  if (remaining.length === 0) {
    await db.delete(workouts)
      .where(and(eq(workouts.id, workout.id), eq(workouts.userId, userId)));
    return { ok: true, workoutDeleted: true };
  }

  await rederiveName(workout, userId);
  return { ok: true, workoutDeleted: false };
});

export const OPTIONS = preflight;

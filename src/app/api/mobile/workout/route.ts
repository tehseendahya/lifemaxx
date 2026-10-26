import { route, HttpError } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { db } from "@/db";
import { workouts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getActiveWorkout, getWorkoutSets } from "@/lib/queries";
import { workoutDetail } from "@/lib/workout-edit";
import { requireUuid } from "../shared";

/**
 * One past workout, every set — the phone's workout detail screen.
 *
 * Every set, warmups included, in logged order and in lb. The phone groups
 * them by exercise; the server does not, because "first-performed order" is a
 * presentation decision and the flat list is what the edit route speaks.
 *
 * `live` is sent rather than refused: the screen needs to say "this session is
 * still running, open Lift" instead of a bare error, and it can only say that
 * if it is told. The write routes are what refuse it.
 */
export const GET = route(async ({ userId, searchParams }) => {
  const id = requireUuid(searchParams.get("id"), "id");

  const [workout] = await db
    .select({
      id: workouts.id,
      name: workouts.name,
      nameIsCustom: workouts.nameIsCustom,
      localDate: workouts.localDate,
      startedAt: workouts.startedAt,
      endedAt: workouts.endedAt,
      status: workouts.status,
    })
    .from(workouts)
    .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
    .limit(1);

  // Unknown and someone else's are the same answer, so neither leaks.
  if (workout === undefined) throw new HttpError("Unknown workout.", 404);

  const [rows, live] = await Promise.all([getWorkoutSets(id), getActiveWorkout(userId)]);
  return workoutDetail(workout, rows, live?.id ?? null);
});

/**
 * Deleting a whole workout.
 *
 * The owner asked for it after a session landed on the wrong day — "maybe add a
 * delete workout feature just in case there are errors". It is the escape hatch
 * for anything a fix-a-set edit cannot reach: a session logged twice, a session
 * logged against the wrong day, a paste that went somewhere it should not have.
 *
 * Its sets go with it: `sets.workout_id` is `ON DELETE CASCADE`. That is the
 * point of the feature, and it is why the phone asks first and says how many
 * sets will go.
 *
 * ── THE ONE REFUSAL ────────────────────────────────────────────────────────
 *
 * The session that is live right now cannot be deleted from here. Its sets are
 * still arriving — some may be in the outbox — and deleting the row under them
 * would send every one of those to `workoutForSetAt` looking for a home that no
 * longer exists. STOP it, or remove sets one at a time on the session screen.
 * A session that has gone idle is not live (see `domain/session.ts`), so an
 * abandoned one can still be cleaned up.
 *
 * `?id=` rather than a body, like the exercise route: a body on a DELETE is not
 * reliably readable across proxies.
 */
export const DELETE = route(async ({ userId, searchParams }) => {
  const id = requireUuid(searchParams.get("id"), "id");

  const live = await getActiveWorkout(userId);
  if (live?.id === id) {
    throw new HttpError("That session is still running. Stop it first.", 409);
  }

  // Scoped by user as well as by id. RLS already guarantees it, and this keeps
  // a wrong id a 404 rather than a silent no-op on someone else's row.
  const deleted = await db.delete(workouts)
    .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
    .returning({ id: workouts.id });

  if (deleted.length === 0) throw new HttpError("Unknown workout.", 404);
  return { ok: true, id };
});

export const OPTIONS = preflight;

import { route, HttpError } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { db } from "@/db";
import { workouts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getActiveWorkout } from "@/lib/queries";
import { requireUuid } from "../shared";

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

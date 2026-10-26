import { route, HttpError } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { db } from "@/db";
import { exercises, sets } from "@/db/schema";
import { and, count, eq, isNull, or } from "drizzle-orm";
import { getExerciseHistory } from "@/lib/queries";
import { displayLb } from "@/lib/domain/units";
import { bestE1rm } from "@/lib/domain/e1rm";
import { getCue } from "@/lib/cues";
import { parseLimit, requireUuid } from "../shared";

/**
 * One exercise's history, for the detail screen pushed from a session card.
 *
 * `?id=` rather than `/exercise/[id]` on purpose: `route()` never receives
 * Next's `params`, so a dynamic segment would mean hand-rolling the auth,
 * timezone and RLS-transaction wrapper that every other route gets for free.
 * A query parameter costs nothing and keeps one code path.
 */
export const GET = route(async ({ userId, searchParams }) => {
  const id = requireUuid(searchParams.get("id"), "id");
  const limit = parseLimit(searchParams.get("limit"), 8, 24);

  // RLS already restricts this to the catalogue plus the user's own rows (see
  // read_catalogue_and_own_exercises in drizzle/0001). The predicate is here
  // anyway so the visibility rule is readable at the call site rather than
  // only in a migration.
  const [exercise] = await db.select({
    id: exercises.id,
    name: exercises.name,
    slug: exercises.slug,
    incrementKg: exercises.incrementKg,
    equipment: exercises.equipment,
  })
    .from(exercises)
    .where(and(
      eq(exercises.id, id),
      or(isNull(exercises.userId), eq(exercises.userId, userId)),
    ))
    .limit(1);

  if (!exercise) throw new HttpError("Unknown exercise.", 404);

  // In parallel: neither read depends on the other, and the detail screen
  // renders the cue above the history, so waiting for one to start the other
  // would delay the first thing on the page.
  const [history, cue] = await Promise.all([
    getExerciseHistory(userId, exercise.id, limit),
    getCue(userId, exercise.id),
  ]);

  const peaks = history
    .map((session) => bestE1rm(session.sets))
    .filter((e): e is number => e !== null);

  return {
    exercise: {
      id: exercise.id,
      name: exercise.name,
      slug: exercise.slug,
      incrementLb: displayLb(exercise.incrementKg),
      equipment: exercise.equipment,
    },
    /**
     * The carry-forward cue for this lift, or null.
     *
     * Here as well as in `bootstrap` because this screen SHOWS the cue, and a
     * screen that displays a value it did not fetch is showing whichever of
     * two caches answered last. The detail screen reads this field; it does
     * not write one — the confirm sheet is the single editor, and
     * `POST exercise/cue` invalidates `queryKeys.exercise(id)` so a cue
     * changed there is refetched through here rather than patched twice.
     */
    cue,
    history: history.map((session) => ({
      // The workout this session was, so a history row can open it.
      workoutId: session.workoutId,
      date: session.date,
      sets: session.sets.map((s) => ({
        reps: s.reps,
        weightLb: displayLb(s.weightKg),
        rpe: s.rpe,
        toFailure: s.toFailure,
        isWarmup: s.isWarmup,
        felt: s.felt,
        note: s.note,
      })),
    })),
    // Best across the window being returned, not all time — the trend on the
    // screen and the number above it are then describing the same sessions.
    bestE1rmLb: peaks.length > 0 ? displayLb(Math.max(...peaks)) : null,
  };
});

/**
 * Hand back an exercise that was created automatically and that nothing ended
 * up pointing at.
 *
 * `parseSetsText` writes a row for every name it cannot resolve, so the
 * confirmation sheet has an id to show a name and log a set against. Most of
 * those are wanted. Some are not, and this is how they go away:
 *
 *   · the user deletes that group from the sheet,
 *   · the user answers "did you mean Barbell Curl?" with yes, which re-files
 *     the sets and leaves the just-created row unreferenced,
 *   · the user discards the whole sheet.
 *
 * The client calls this fire-and-forget at all three sites and treats a failure
 * as nothing, which is right: an unreferenced exercise is invisible in every
 * screen that ranks by volume, and a failed clean-up is not news in the middle
 * of logging a set. So the status codes below are for whoever reads the logs,
 * not for the phone.
 *
 * ── THE TWO THINGS IT REFUSES ──────────────────────────────────────────────
 *
 * A CATALOGUE ROW. `user_id IS NULL` is the shared catalogue, readable by
 * everyone and writable by nobody; `write_own_exercises` in drizzle/0001 would
 * raise anyway, but refusing here names the reason instead of surfacing a
 * policy violation.
 *
 * A ROW WITH SETS. `sets.exercise_id` is `ON DELETE RESTRICT`, so the database
 * is the real guarantee and this check cannot be raced past — but the count
 * runs first so the answer is a 409 that says why rather than a 500 from a
 * foreign-key violation. This is the invariant that matters: however wrong the
 * caller is, this route cannot take history with it.
 *
 * `exercise_muscles` and `exercise_aliases` both cascade, so the inferred
 * muscles and the learned wording go with the row and no orphan is left to
 * resolve a future query onto a deleted exercise.
 *
 * `?id=` rather than a body: a body on a DELETE is not reliably readable
 * across proxies, and `route()` tolerates its absence.
 */
export const DELETE = route(async ({ userId, searchParams }) => {
  const id = requireUuid(searchParams.get("id"), "id");

  const [exercise] = await db.select({ id: exercises.id, userId: exercises.userId })
    .from(exercises)
    .where(and(
      eq(exercises.id, id),
      or(isNull(exercises.userId), eq(exercises.userId, userId)),
    ))
    .limit(1);

  if (!exercise) throw new HttpError("Unknown exercise.", 404);
  if (exercise.userId === null) {
    throw new HttpError("A catalogue exercise cannot be deleted.", 409);
  }

  const [{ value: logged }] = await db.select({ value: count() })
    .from(sets)
    .where(eq(sets.exerciseId, id));

  if (Number(logged) > 0) {
    throw new HttpError("That exercise has sets logged against it.", 409);
  }

  await db.delete(exercises).where(and(eq(exercises.id, id), eq(exercises.userId, userId)));

  return { ok: true as const };
});

export const OPTIONS = preflight;

import { route, HttpError } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { db } from "@/db";
import { exercises } from "@/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { getExerciseHistory } from "@/lib/queries";
import { displayLb } from "@/lib/domain/units";
import { bestE1rm } from "@/lib/domain/e1rm";
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

  const history = await getExerciseHistory(userId, exercise.id, limit);

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
    history: history.map((session) => ({
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

export const OPTIONS = preflight;

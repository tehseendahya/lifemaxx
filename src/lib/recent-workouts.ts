import { displayLb } from "./domain/units";

/**
 * Past workouts, as workouts.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The phone's "Last session" card never knew what a workout was. It was built
 * from `bootstrap.lastSets` — each exercise's most recent date — and treated
 * every exercise sharing the newest date as one session. That is the owner's
 * report, almost word for word:
 *
 *   "it for some reason combined all my stuff into one lift as it thinks today
 *    is all one day"
 *
 * Their chest-and-biceps workout and their back-and-triceps workout were two
 * separate rows in `workouts`. They were drawn as one because the card grouped
 * by DATE, and both carried the same date (the profile timezone was still the
 * New York default, so a Sydney Monday noon was a New York Sunday). Correcting
 * the timezone fixes the date, but not the card: a genuine two-a-day would
 * still have been glued together, which was their second complaint —
 * "when another exercise is recorded on the same day, it shouldn't
 * automatically assume it's the same workout".
 *
 * So the server now sends the workouts themselves, each with its own lifts,
 * and the phone stops reconstructing sessions from dates. The same list is
 * what a workout can be deleted from.
 *
 * Kept free of `@/db` for the reason `history.ts` is: `queries.ts` opens a
 * connection at import, and the grouping here is a decision worth testing.
 */

export interface RecentWorkoutRow {
  workoutId: string;
  name: string;
  localDate: string;
  startedAt: Date;
  endedAt: Date | null;
  exerciseId: string;
  reps: number;
  weightKg: number;
  rpe: number | null;
  isWarmup: boolean;
  loggedAt: Date;
}

export interface RecentWorkoutExercise {
  exerciseId: string;
  /** Working sets only. */
  sets: number;
  weightLb: number;
  reps: number;
  rpe: number | null;
}

export interface RecentWorkout {
  id: string;
  name: string;
  localDate: string;
  startedAt: string;
  /** Null for a workout that never recorded an end. */
  durationMin: number | null;
  /** Working sets across the whole workout. */
  workingSets: number;
  /** In the order they were first performed. */
  exercises: RecentWorkoutExercise[];
}

/**
 * The weight×reps the session actually was.
 *
 * Mode rather than max or last: 3×8 at 185 with a dropped fourth set at 135 is
 * a 185×8 session, and opening the pad on either the heaviest or the final set
 * would be wrong in opposite directions. Ties break toward the heavier load,
 * then the higher reps — the work rather than the outlier.
 */
export function modalSet<T extends { weightKg: number; reps: number }>(working: T[]): T {
  const counts = new Map<string, { set: T; n: number }>();
  for (const s of working) {
    const key = `${s.weightKg}:${s.reps}`;
    const seen = counts.get(key);
    if (seen) seen.n += 1;
    else counts.set(key, { set: s, n: 1 });
  }
  return [...counts.values()].sort(
    (a, b) =>
      b.n - a.n || b.set.weightKg - a.set.weightKg || b.set.reps - a.set.reps,
  )[0].set;
}

/**
 * Set rows → one entry per workout, newest first.
 *
 * Grouped by `workoutId` and nothing else. That is the entire fix: two
 * workouts on one date stay two workouts.
 *
 * An exercise of nothing but warmups is left out of `exercises`, the same rule
 * `lastSets` follows — it is not something to repeat — but its sets still
 * count toward nothing, because `workingSets` is working sets. A workout whose
 * sets were ALL warmups still appears: it happened, and it may be exactly the
 * mistake someone opened this list to delete.
 */
export function groupRecentWorkouts(rows: RecentWorkoutRow[]): RecentWorkout[] {
  const byWorkout = new Map<string, RecentWorkoutRow[]>();
  for (const row of rows) {
    const list = byWorkout.get(row.workoutId);
    if (list) list.push(row);
    else byWorkout.set(row.workoutId, [row]);
  }

  const out: RecentWorkout[] = [];
  for (const [id, all] of byWorkout) {
    const head = all[0];

    const byExercise = new Map<string, RecentWorkoutRow[]>();
    for (const row of [...all].sort((a, b) => +a.loggedAt - +b.loggedAt)) {
      const list = byExercise.get(row.exerciseId);
      if (list) list.push(row);
      else byExercise.set(row.exerciseId, [row]);
    }

    const exercises: RecentWorkoutExercise[] = [];
    for (const [exerciseId, sets] of byExercise) {
      const working = sets.filter((s) => !s.isWarmup);
      if (working.length === 0) continue;
      const top = modalSet(working);
      const rpes = working.map((s) => s.rpe).filter((r): r is number => r !== null);
      exercises.push({
        exerciseId,
        sets: working.length,
        weightLb: displayLb(top.weightKg),
        reps: top.reps,
        rpe: rpes.length > 0 ? Math.max(...rpes) : null,
      });
    }

    out.push({
      id,
      name: head.name,
      localDate: head.localDate,
      startedAt: head.startedAt.toISOString(),
      durationMin:
        head.endedAt === null
          ? null
          : Math.max(0, Math.round((+head.endedAt - +head.startedAt) / 60_000)),
      workingSets: all.filter((s) => !s.isWarmup).length,
      exercises,
    });
  }

  // Newest first, by when it STARTED — not by date, which is the field that
  // was wrong in the first place, and which two workouts in a day share.
  return out.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

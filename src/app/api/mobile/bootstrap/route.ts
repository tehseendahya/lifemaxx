import { route } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { db } from "@/db";
import { exerciseMuscles, exercises, sets, workouts } from "@/db/schema";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  getProfile, getActiveTarget, getDayMeals, sumMacros, getMuscleVolume,
  getTdee, defaultProteinTarget, getActiveWorkout, getRuns,
  getLowerBodyLiftDates, getGyms, getDailyIntake, getBodyweightSeries,
  getDailyHardSets, getMainLiftE1rmSeries, shiftDate, HISTORY_LOOKBACK_DAYS,
} from "@/lib/queries";
import { mergeHistoryDays } from "@/lib/history";
import { getCues } from "@/lib/cues";
import { summarize } from "@/lib/domain/readiness";
import { displayLb } from "@/lib/domain/units";
import { bestE1rm } from "@/lib/domain/e1rm";

/**
 * Everything the phone needs, in one request.
 *
 * Deliberately one fat call rather than six small ones. The user lifts in a
 * basement with no signal: the app gets one chance at the network on the way
 * in, and after that it has to run on what it already holds. Six round trips
 * means six chances to be holding half a dashboard.
 *
 * `history` is the one field added for the Today dashboard, and it is raw for
 * the same reason: 56 daily rows plus up to three e1RM series, with every
 * streak, weekly bucket, rolling mean and lift-day count left to pure functions
 * on the device. A server-computed streak would be a second implementation of a
 * rule the client has to be able to render anyway, and the two would disagree
 * the first time one of them was changed. Run mileage is deliberately NOT in
 * here — `runs` already carries 56 days of raw runs and the phone already runs
 * `weeklyRunStats()` on them.
 *
 * `runs` and `lowerBodyLiftDates` go over the wire raw, which looks wasteful
 * until you notice the alternative: the native app runs the same
 * `summarizeRunningWeek()` on them that the web page runs, so the two clients
 * cannot disagree about the week's mileage. Precomputing it here would create a
 * second implementation of the thing the shared domain layer exists to prevent.
 */
export const GET = route(async ({ userId, tz, today }) => {
  const [
    profile, target, meals, volume, tdee, proteinFloor,
    active, runs, lowerBodyLiftDates, gymList, catalogueRows, lastSets,
    weighInSeries, intakeSeries, hardSetDays, mainLiftSeries, cues,
  ] = await Promise.all([
    getProfile(userId),
    getActiveTarget(userId, today),
    getDayMeals(userId, today),
    getMuscleVolume(userId, today),
    getTdee(userId, today),
    defaultProteinTarget(userId),
    getActiveWorkout(userId),
    getRuns(userId, today),
    getLowerBodyLiftDates(userId, today),
    getGyms(userId),
    // The same catalogue query src/app/lift/page.tsx runs — the user's own
    // exercises plus the shared ones — with the increment the number pad needs.
    db.select({
      id: exercises.id,
      name: exercises.name,
      slug: exercises.slug,
      incrementKg: exercises.incrementKg,
      equipment: exercises.equipment,
    })
      .from(exercises)
      .where(or(isNull(exercises.userId), eq(exercises.userId, userId)))
      .orderBy(asc(exercises.name)),
    lastSetPerExercise(userId),

    /*
     * The four reads behind `history`, the Today dashboard's charts.
     *
     * They are in this `Promise.all` rather than in a helper of their own so
     * they go down the one pooled connection in parallel with everything else.
     * The whole point of this endpoint is that the phone gets one round trip on
     * the way into a basement; four sequential queries appended to the end of it
     * would be four more chances to still be waiting when the signal goes.
     */
    getBodyweightSeries(userId, today),
    getDailyIntake(userId, shiftDate(today, -HISTORY_LOOKBACK_DAYS)),
    getDailyHardSets(userId, today),
    getMainLiftE1rmSeries(userId, today),

    /*
     * The per-exercise cues, for the same reason `lastSets` is here: a cue is
     * worthless if it is not on screen in the basement, and this is the one
     * round trip the phone gets on the way in.
     *
     * It is the cheapest read in this list. `user_id` is the leading column of
     * `exercise_cues`'s composite primary key and the only predicate, and the
     * result is one row per lift the owner has actually written a cue for — a
     * handful, not a catalogue. Measured against the local Postgres with the
     * RLS policy in play: 0.022 ms, one buffer hit, and the policy collapses
     * to a one-time filter rather than a per-row test. Being inside this
     * `Promise.all` rather than appended to it is what keeps that cost off the
     * launch-blocking critical path entirely.
     */
    getCues(userId),
  ]);

  const muscleMap = await muscleMapFor(catalogueRows.map((row) => row.id));

  return {
    today,
    tz,
    goalsText: profile?.goalsText ?? "",

    target: {
      kcal: target?.kcal ?? null,
      // There is always a protein number, target or not — it is the one figure
      // that is correct before calibration finishes. See domain/tdee.
      proteinG: target?.proteinG ?? proteinFloor,
      carbsG: target?.carbsG ?? null,
      fatG: target?.fatG ?? null,
      mode: target?.mode ?? "calibrating",
    },
    totals: sumMacros(meals),
    mealCount: meals.length,

    volume: {
      summary: summarize(volume.ranked),
      ranked: volume.ranked.map((r) => ({
        muscle: r.muscle,
        label: r.label,
        setsLast7d: r.setsLast7d,
        daysSinceTrained: r.daysSinceTrained,
        score: r.score,
      })),
    },
    tdee,

    activeWorkout: active ? { id: active.id, startedAt: active.startedAt.toISOString() } : null,

    runs: runs.map((r) => ({
      id: r.id,
      localDate: r.localDate,
      startedAt: r.startedAt.toISOString(),
      name: r.name,
      type: r.type,
      distanceM: r.distanceM,
      durationS: r.durationS,
      elevationM: r.elevationM,
      avgHr: r.avgHr,
      sufferScore: r.sufferScore,
      verdict: r.verdict,
    })),
    lowerBodyLiftDates,

    gyms: gymList.map((g) => ({ id: g.id, name: g.name, isDefault: g.isDefault })),

    catalogue: catalogueRows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      incrementLb: displayLb(row.incrementKg),
      equipment: row.equipment,
      muscles: muscleMap.get(row.id) ?? [],
    })),
    lastSets,

    /**
     * Carry-forward cues, keyed by exercise id. Lifts without one are ABSENT
     * rather than present as `""`, the same rule `lastSets` follows — so
     * `cues[id] === undefined` is the single answer to "is there a cue here".
     */
    cues,

    history: {
      days: mergeHistoryDays(weighInSeries, intakeSeries, hardSetDays),
      mainLifts: mainLiftSeries.map((lift) => ({
        exerciseId: lift.exerciseId,
        name: lift.name,
        points: lift.points.map((p) => ({ date: p.date, e1rmLb: displayLb(p.e1rmKg) })),
      })),
    },
  };
});

export const OPTIONS = preflight;

/**
 * Which muscles each catalogue exercise works, and by how much.
 *
 * NOT `musclesFor()` from src/lib/exercises.ts, which looks like the right
 * helper and is not: it builds `exercise_id = ANY(${ids})`, and drizzle's `sql`
 * template expands a JS array into a parameter *list*, so Postgres receives
 * `= ANY(($1, $2, …))` and rejects it with "op ANY/ALL (array) requires array
 * on right side". That function has no other caller today, so the bug has never
 * fired — it is reported rather than fixed here because src/lib/exercises.ts
 * belongs to another workstream.
 */
async function muscleMapFor(exerciseIds: string[]) {
  const map = new Map<string, { muscle: string; contribution: number }[]>();
  if (exerciseIds.length === 0) return map;

  const rows = await db.select({
    exerciseId: exerciseMuscles.exerciseId,
    muscle: exerciseMuscles.muscle,
    contribution: exerciseMuscles.contribution,
  })
    .from(exerciseMuscles)
    .where(inArray(exerciseMuscles.exerciseId, exerciseIds));

  for (const row of rows) {
    map.set(row.exerciseId, [
      ...(map.get(row.exerciseId) ?? []),
      { muscle: row.muscle, contribution: row.contribution },
    ]);
  }
  return map;
}

export interface LastSet {
  localDate: string;
  weightLb: number;
  reps: number;
  rpe: number | null;
  sets: number;
  bestE1rmLb: number | null;
}

/**
 * What you did last time, for every exercise you have ever done.
 *
 * This is the field that makes "repeat last set" work with no signal, which is
 * the whole point of logging mid-workout in a basement. It is also the most
 * expensive thing in the payload, hence one window-function query rather than
 * one query per exercise.
 *
 * `dense_rank` over (exercise, date desc) picks the most recent *completed*
 * session per exercise — completed because an abandoned session is not a
 * baseline, and the one currently in progress is already on screen.
 */
async function lastSetPerExercise(userId: string): Promise<Record<string, LastSet>> {
  const latest = db
    .select({
      exerciseId: sets.exerciseId,
      localDate: workouts.localDate,
      reps: sets.reps,
      weightKg: sets.weightKg,
      rpe: sets.rpe,
      isWarmup: sets.isWarmup,
      rank: sql<number>`dense_rank() over (
        partition by ${sets.exerciseId}
        order by ${workouts.localDate} desc, ${workouts.startedAt} desc
      )`.as("rank"),
    })
    .from(sets)
    .innerJoin(workouts, eq(workouts.id, sets.workoutId))
    .where(and(eq(workouts.userId, userId), eq(workouts.status, "completed")))
    .as("latest");

  const rows = await db
    .select({
      exerciseId: latest.exerciseId,
      localDate: latest.localDate,
      reps: latest.reps,
      weightKg: latest.weightKg,
      rpe: latest.rpe,
      isWarmup: latest.isWarmup,
    })
    .from(latest)
    .where(eq(latest.rank, 1));

  const byExercise = new Map<string, typeof rows>();
  for (const row of rows) {
    byExercise.set(row.exerciseId, [...(byExercise.get(row.exerciseId) ?? []), row]);
  }

  const out: Record<string, LastSet> = {};
  for (const [exerciseId, all] of byExercise) {
    const working = all.filter((s) => !s.isWarmup);
    // A session of nothing but warmups is not something to repeat, so the
    // exercise is simply absent and the phone falls back to an empty pad.
    if (working.length === 0) continue;

    const top = modalSet(working);
    const rpes = working.map((s) => s.rpe).filter((r): r is number => r !== null);

    out[exerciseId] = {
      localDate: all[0].localDate,
      weightLb: displayLb(top.weightKg),
      reps: top.reps,
      rpe: rpes.length > 0 ? Math.max(...rpes) : null,
      sets: working.length,
      bestE1rmLb: toLbOrNull(bestE1rm(working)),
    };
  }
  return out;
}

/**
 * The weight×reps the session actually was.
 *
 * Mode rather than max or last: 3×8 at 185 with a dropped fourth set at 135 is
 * a 185×8 session, and opening the pad on either the heaviest or the final set
 * would be wrong in opposite directions. Ties break toward the heavier load,
 * then the higher reps — the work rather than the outlier.
 */
function modalSet(working: { weightKg: number; reps: number }[]) {
  const counts = new Map<string, { weightKg: number; reps: number; n: number }>();
  for (const s of working) {
    const key = `${s.weightKg}:${s.reps}`;
    const seen = counts.get(key);
    if (seen) seen.n += 1;
    else counts.set(key, { weightKg: s.weightKg, reps: s.reps, n: 1 });
  }
  return [...counts.values()].sort(
    (a, b) => b.n - a.n || b.weightKg - a.weightKg || b.reps - a.reps,
  )[0];
}

const toLbOrNull = (kg: number | null): number | null => (kg === null ? null : displayLb(kg));

import { db } from "@/db";
import {
  meals, mealItems, sets, workouts, exercises, exerciseMuscles,
  bodyMetrics, targets, profiles, activities, gyms, weeklyRunningSummaries,
  type Muscle, MUSCLES,
} from "@/db/schema";
import { and, desc, eq, gte, lte, sql, inArray } from "drizzle-orm";
import { hardSetsByMuscle, type CountedSet } from "./domain/muscles";
import { rankMuscles, type MuscleState } from "./domain/readiness";
import { estimateTdee, proteinTargetG, WINDOW_DAYS, type WeighIn } from "./domain/tdee";
import { isRun, LOWER_BODY, weekStartOf, type Run } from "./domain/running";
import { bestE1rm } from "./domain/e1rm";
import { sessionEndedBy, type SessionActivity } from "./domain/session";

/** Local date string for a user's timezone — the app's unit of "a day". */
export function localDate(tz: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
}

export function daysAgo(iso: string, from: string): number {
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${from}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getProfile(userId: string) {
  const [row] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
  return row ?? null;
}

export async function getActiveTarget(userId: string, today: string) {
  const [row] = await db.select().from(targets)
    .where(and(eq(targets.userId, userId), sql`${targets.effectiveFrom} <= ${today}`))
    .orderBy(desc(targets.effectiveFrom)).limit(1);
  return row ?? null;
}

// ------------------------------------------------------------------ meals

export async function getDayMeals(userId: string, date: string) {
  const rows = await db.select().from(meals)
    .where(and(eq(meals.userId, userId), eq(meals.localDate, date)))
    .orderBy(meals.eatenAt);

  const items = rows.length
    ? await db.select().from(mealItems).where(inArray(mealItems.mealId, rows.map((m) => m.id)))
    : [];

  const byMeal = new Map<string, typeof items>();
  for (const i of items) byMeal.set(i.mealId, [...(byMeal.get(i.mealId) ?? []), i]);

  return rows.map((m) => ({ ...m, items: byMeal.get(m.id) ?? [] }));
}

export function sumMacros(list: { kcal: number; proteinG: number; carbsG: number; fatG: number }[]) {
  return list.reduce(
    (acc, m) => ({
      kcal: acc.kcal + m.kcal,
      proteinG: acc.proteinG + m.proteinG,
      carbsG: acc.carbsG + m.carbsG,
      fatG: acc.fatG + m.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}

export async function getDailyIntake(userId: string, sinceDate: string) {
  return db
    .select({
      localDate: meals.localDate,
      kcal: sql<number>`sum(${meals.kcal})::int`,
    })
    .from(meals)
    .where(and(eq(meals.userId, userId), gte(meals.localDate, sinceDate)))
    .groupBy(meals.localDate);
}

// ------------------------------------------------------------------ training

/**
 * The session that is live — not merely the one left in `status = 'active'`.
 *
 * Those used to be the same thing, and that was the bug. Nothing ended a
 * session except a tap on STOP, so a workout walked away from stayed open
 * forever and the next day's sets were written into it, under the previous
 * day's `localDate`. `sessionEndedBy` is the rule; see `domain/session.ts`.
 *
 * ── `at` IS NOT `Date.now()`, AND THAT IS THE POINT ────────────────────────
 *
 * A set logged in a basement reaches the server whenever the phone next has
 * signal, which can be hours later. It belongs to the session that was alive
 * when it was LOGGED, so `POST /api/sets` passes the set's own `loggedAt` and
 * a morning session uploaded at six in the evening still lands in the morning.
 * Defaulting this to now would have turned every delayed delivery into "Start
 * a session first", which is a worse bug than the one being fixed.
 *
 * This does NOT write: a stale session is filtered out, not closed. Closing it
 * is `closeStaleSession` below, called from the paths that are already writing.
 * A read that quietly mutates is a read nobody can reason about.
 */
export async function getActiveWorkout(userId: string, at: Date = new Date()) {
  const [row] = await db.select().from(workouts)
    .where(and(eq(workouts.userId, userId), eq(workouts.status, "active")))
    .orderBy(desc(workouts.startedAt)).limit(1);

  if (!row) return null;
  return sessionEndedBy(await activityOf(row), at) ? null : row;
}

/**
 * The workout a set belongs to, chosen by WHEN IT WAS LOGGED.
 *
 * `getActiveWorkout` answers "is a session running right now", which is the
 * question the Lift screen asks. This answers a different one, and `POST
 * /api/sets` needs this one: *which session was I in at 7:05 this morning?*
 *
 * They came apart the moment sessions were given a lifetime. Consider the case
 * this exists for, which is the ordinary one in a basement gym:
 *
 *   07:00  start, log four sets, no signal — all four sit in the outbox
 *   07:40  last set; phone goes in a pocket, app suspends
 *   18:00  app reopened. The 7am session is long idle, so tapping START LIFT
 *          closes it and opens a new one — and only THEN does the outbox get
 *          its flush
 *
 * Asked "is a session active", those four sets get a 400, are classified
 * permanent, and are dropped. The morning is gone. Asked "which session was
 * live at 07:05", they land where they were always meant to, in a workout that
 * now happens to be closed. Closed is not the same as wrong.
 *
 * So status is deliberately not part of the predicate: a workout is the right
 * home for a set if the set was logged after it started and before it went
 * idle. `abandoned` is the one exclusion — that status means "this was a
 * mistake, bin it", and a set arriving for one is better off re-homed than
 * resurrecting a session the user discarded.
 */
export async function workoutForSetAt(userId: string, at: Date) {
  const rows = await db.select().from(workouts)
    .where(and(
      eq(workouts.userId, userId),
      inArray(workouts.status, ["active", "completed"]),
      // `lte`, not a `sql` template: a raw Date interpolated into one reaches
      // the driver as a Date and is rejected outright ("must be of type
      // string"). The typed operator knows the column is a timestamptz and
      // serialises it.
      lte(workouts.startedAt, at),
    ))
    .orderBy(desc(workouts.startedAt)).limit(1);

  const row = rows[0];
  if (!row) return null;

  // The same idle rule, read from the other side: the set is in range if the
  // session had not yet ended by the time it was logged.
  return sessionEndedBy(await activityOf(row), at) ? null : row;
}

/**
 * When a workout was last alive — its last set, or its start if it has none.
 *
 * The timestamp is coerced rather than trusted: `max()` over a `timestamptz`
 * comes back as a `Date` from this driver, but an aggregate's type is the one
 * place drizzle cannot check that claim, and a string here would make every
 * arithmetic comparison in `sessionEndedBy` silently `NaN` — which compares
 * false, so every session would read as live and the original bug would be
 * back with tests still green.
 */
export async function activityOf(
  workout: { id: string; startedAt: Date },
): Promise<SessionActivity> {
  const [row] = await db.select({ lastSetAt: sql<Date | string | null>`max(${sets.loggedAt})` })
    .from(sets).where(eq(sets.workoutId, workout.id));

  const raw = row?.lastSetAt ?? null;
  const lastSetAt = raw === null ? null : new Date(raw);
  return {
    startedAt: workout.startedAt,
    lastSetAt: lastSetAt !== null && !Number.isNaN(lastSetAt.getTime()) ? lastSetAt : null,
  };
}

export async function getWorkoutSets(workoutId: string) {
  return db
    .select({
      id: sets.id, clientId: sets.clientId, exerciseId: sets.exerciseId, setIndex: sets.setIndex,
      reps: sets.reps, weightKg: sets.weightKg, rpe: sets.rpe,
      toFailure: sets.toFailure, isWarmup: sets.isWarmup, restS: sets.restS,
      note: sets.note, felt: sets.felt, loggedAt: sets.loggedAt,
      exerciseName: exercises.name, exerciseSlug: exercises.slug,
      incrementKg: exercises.incrementKg,
    })
    .from(sets)
    .innerJoin(exercises, eq(exercises.id, sets.exerciseId))
    .where(eq(sets.workoutId, workoutId))
    .orderBy(sets.loggedAt);
}

/** Recent sessions for one exercise, newest first — feeds the baseline. */
export async function getExerciseHistory(userId: string, exerciseId: string, limit = 8) {
  const rows = await db
    .select({
      workoutId: sets.workoutId, localDate: workouts.localDate,
      reps: sets.reps, weightKg: sets.weightKg, rpe: sets.rpe,
      toFailure: sets.toFailure, isWarmup: sets.isWarmup, felt: sets.felt, note: sets.note,
    })
    .from(sets)
    .innerJoin(workouts, eq(workouts.id, sets.workoutId))
    .where(and(
      eq(workouts.userId, userId),
      eq(sets.exerciseId, exerciseId),
      eq(workouts.status, "completed"),
    ))
    .orderBy(desc(workouts.localDate), sets.setIndex);

  const grouped = new Map<string, { date: string; sets: typeof rows }>();
  for (const r of rows) {
    const g = grouped.get(r.workoutId) ?? { date: r.localDate, sets: [] as typeof rows };
    g.sets.push(r);
    grouped.set(r.workoutId, g);
  }
  return [...grouped.values()].slice(0, limit);
}

/** Hard sets per muscle over a rolling window, plus recency. */
export async function getMuscleVolume(userId: string, today: string, windowDays = 7) {
  const since = shiftDate(today, -windowDays);

  const rows = await db
    .select({
      muscle: exerciseMuscles.muscle,
      contribution: exerciseMuscles.contribution,
      isWarmup: sets.isWarmup,
      localDate: workouts.localDate,
      felt: sets.felt,
    })
    .from(sets)
    .innerJoin(workouts, eq(workouts.id, sets.workoutId))
    .innerJoin(exerciseMuscles, eq(exerciseMuscles.exerciseId, sets.exerciseId))
    .where(and(eq(workouts.userId, userId), gte(workouts.localDate, since)));

  const counted: CountedSet[] = rows.map((r) => ({
    isWarmup: r.isWarmup,
    muscles: [{ muscle: r.muscle, contribution: r.contribution }],
  }));
  const volume = hardSetsByMuscle(counted);

  // Recency needs a wider lookback than the volume window.
  const recencyRows = await db
    .select({ muscle: exerciseMuscles.muscle, localDate: sql<string>`max(${workouts.localDate})` })
    .from(sets)
    .innerJoin(workouts, eq(workouts.id, sets.workoutId))
    .innerJoin(exerciseMuscles, eq(exerciseMuscles.exerciseId, sets.exerciseId))
    .where(and(eq(workouts.userId, userId), eq(sets.isWarmup, false)))
    .groupBy(exerciseMuscles.muscle);

  const lastTrained = new Map(recencyRows.map((r) => [r.muscle, r.localDate]));

  const states: MuscleState[] = MUSCLES.map((m) => {
    const last = lastTrained.get(m);
    const weakRows = rows.filter((r) => r.muscle === m && !r.isWarmup);
    const weak = weakRows.filter((r) => r.felt === "weak").length;
    return {
      muscle: m as Muscle,
      setsLast7d: volume.get(m as Muscle) ?? 0,
      daysSinceTrained: last ? daysAgo(last, today) : null,
      weakShare: weakRows.length > 0 ? weak / weakRows.length : 0,
    };
  });

  return { states, ranked: rankMuscles(states) };
}

// ------------------------------------------------------------------ body

export async function getWeighIns(userId: string, today: string): Promise<WeighIn[]> {
  const since = shiftDate(today, -WINDOW_DAYS);
  const rows = await db
    .select({ localDate: bodyMetrics.localDate, weightKg: bodyMetrics.weightKg })
    .from(bodyMetrics)
    .where(and(
      eq(bodyMetrics.userId, userId),
      gte(bodyMetrics.localDate, since),
      sql`${bodyMetrics.weightKg} is not null`,
    ))
    .orderBy(bodyMetrics.localDate);
  return rows.map((r) => ({ localDate: r.localDate, weightKg: r.weightKg! }));
}

export async function getTdee(userId: string, today: string) {
  const since = shiftDate(today, -WINDOW_DAYS);
  const [weighIns, intake] = await Promise.all([
    getWeighIns(userId, today),
    getDailyIntake(userId, since),
  ]);
  return estimateTdee(weighIns, intake.map((i) => ({ localDate: i.localDate, kcal: i.kcal })));
}

export async function latestBodyweightKg(userId: string): Promise<number | null> {
  const [row] = await db.select({ w: bodyMetrics.weightKg }).from(bodyMetrics)
    .where(and(eq(bodyMetrics.userId, userId), sql`${bodyMetrics.weightKg} is not null`))
    .orderBy(desc(bodyMetrics.localDate)).limit(1);
  return row?.w ?? null;
}

export async function defaultProteinTarget(userId: string): Promise<number> {
  const bw = await latestBodyweightKg(userId);
  return bw ? proteinTargetG(bw) : 150;
}

// ------------------------------------------------------------------ misc

export async function getGyms(userId: string) {
  return db.select().from(gyms).where(eq(gyms.userId, userId)).orderBy(desc(gyms.isDefault));
}

export async function getRecentActivities(userId: string, today: string, days = 14) {
  return db.select().from(activities)
    .where(and(eq(activities.userId, userId), gte(activities.localDate, shiftDate(today, -days))))
    .orderBy(desc(activities.startedAt));
}


// ------------------------------------------------------------------ running

/** How far back the running views and the weekly rollup look. */
export const RUNNING_LOOKBACK_DAYS = 56;

export interface StoredRun extends Run {
  id: string;
  startedAt: Date;
  verdict: string | null;
}

/**
 * Runs only — rides and swims are stored in the same table but are not what the
 * half-marathon goal is about, and averaging a bike pace into a running pace
 * would be nonsense.
 */
export async function getRuns(
  userId: string,
  today: string,
  days = RUNNING_LOOKBACK_DAYS,
): Promise<StoredRun[]> {
  const rows = await db.select().from(activities)
    .where(and(eq(activities.userId, userId), gte(activities.localDate, shiftDate(today, -days))))
    .orderBy(desc(activities.startedAt));

  return rows.filter((r) => isRun(r.type)).map((r) => ({
    id: r.id,
    localDate: r.localDate,
    startedAt: r.startedAt,
    name: r.name,
    type: r.type,
    distanceM: r.distanceM,
    durationS: r.durationS,
    elevationM: r.elevationM,
    avgHr: r.avgHr,
    sufferScore: r.sufferScore,
    verdict: r.verdict,
  }));
}

/**
 * The days a real lower-body session happened, for interference detection.
 *
 * Warmups are excluded and a token half-set of calf raises should not make a
 * Tuesday count as leg day, so it takes a threshold of hard sets.
 */
export const LOWER_BODY_DAY_THRESHOLD = 3;

export async function getLowerBodyLiftDates(
  userId: string,
  today: string,
  days = RUNNING_LOOKBACK_DAYS,
): Promise<string[]> {
  const rows = await db
    .select({
      localDate: workouts.localDate,
      contribution: exerciseMuscles.contribution,
      muscle: exerciseMuscles.muscle,
    })
    .from(sets)
    .innerJoin(workouts, eq(workouts.id, sets.workoutId))
    .innerJoin(exerciseMuscles, eq(exerciseMuscles.exerciseId, sets.exerciseId))
    .where(and(
      eq(workouts.userId, userId),
      eq(sets.isWarmup, false),
      gte(workouts.localDate, shiftDate(today, -days)),
    ));

  const byDate = new Map<string, number>();
  for (const row of rows) {
    if (!LOWER_BODY.includes(row.muscle as Muscle)) continue;
    byDate.set(row.localDate, (byDate.get(row.localDate) ?? 0) + row.contribution);
  }

  return [...byDate.entries()]
    .filter(([, hardSets]) => hardSets >= LOWER_BODY_DAY_THRESHOLD)
    .map(([date]) => date)
    .sort();
}

export async function getWeeklyRunningSummary(userId: string, today: string) {
  const [row] = await db.select().from(weeklyRunningSummaries)
    .where(and(
      eq(weeklyRunningSummaries.userId, userId),
      eq(weeklyRunningSummaries.weekStart, weekStartOf(today)),
    ))
    .limit(1);
  return row ?? null;
}

export async function getRecentWeeklyRunningSummaries(userId: string, limit = 8) {
  return db.select().from(weeklyRunningSummaries)
    .where(eq(weeklyRunningSummaries.userId, userId))
    .orderBy(desc(weeklyRunningSummaries.weekStart))
    .limit(limit);
}


// ------------------------------------------------------------------ history

/**
 * How far back the Today dashboard's charts look.
 *
 * Eight weeks, which is the shortest window in which a weekly-volume bar chart
 * has enough buckets to show a shape and an e1RM trend has enough sessions to
 * be a trend rather than two dots. It is deliberately the same number as
 * `RUNNING_LOOKBACK_DAYS`, because the Today screen plots lifting load and run
 * mileage against one shared set of week buckets — two different lookbacks
 * would silently truncate one of the two panels.
 */
export const HISTORY_LOOKBACK_DAYS = 56;

/**
 * Every weigh-in in the chart window.
 *
 * A sibling of `getWeighIns` rather than a parameter on it. `getWeighIns` is
 * hard-capped at `WINDOW_DAYS` (28) and is the input to `estimateTdee`;
 * widening it would change the measured maintenance figure the whole app is
 * built on, which is not a charting decision to make by accident.
 */
export async function getBodyweightSeries(
  userId: string,
  today: string,
  days = HISTORY_LOOKBACK_DAYS,
): Promise<WeighIn[]> {
  const rows = await db
    .select({ localDate: bodyMetrics.localDate, weightKg: bodyMetrics.weightKg })
    .from(bodyMetrics)
    .where(and(
      eq(bodyMetrics.userId, userId),
      gte(bodyMetrics.localDate, shiftDate(today, -days)),
      sql`${bodyMetrics.weightKg} is not null`,
    ))
    .orderBy(bodyMetrics.localDate);
  return rows.map((r) => ({ localDate: r.localDate, weightKg: r.weightKg! }));
}

/**
 * Working sets per day — whole sets, not muscle-weighted fractions.
 *
 * `hardSetsByMuscle()` answers a different question (how much stimulus each
 * muscle got) and its numbers are larger, because one bench press set counts
 * 1.0 to chest and 0.5 to triceps. The dashboard labels this one "WEEKLY HARD
 * SETS" and means sets you did, so it is a plain count.
 *
 * Deliberately NOT filtered on `workouts.status`: the session in progress right
 * now is part of today's load, and excluding it would make the current week's
 * bar tick up only after the user remembered to press stop.
 */
export async function getDailyHardSets(
  userId: string,
  today: string,
  days = HISTORY_LOOKBACK_DAYS,
): Promise<{ localDate: string; hardSets: number }[]> {
  return db
    .select({
      localDate: workouts.localDate,
      hardSets: sql<number>`count(*)::int`,
    })
    .from(sets)
    .innerJoin(workouts, eq(workouts.id, sets.workoutId))
    .where(and(
      eq(workouts.userId, userId),
      eq(sets.isWarmup, false),
      gte(workouts.localDate, shiftDate(today, -days)),
    ))
    .groupBy(workouts.localDate);
}

export interface MainLiftSeries {
  exerciseId: string;
  name: string;
  /** Ascending by date, one point per session that produced a usable e1RM. */
  points: { date: string; e1rmKg: number }[];
}

/**
 * The lifts with the most logged sessions in the window, as e1RM over time.
 *
 * `bestE1rm()` is applied per (exercise, day) group in JS rather than reading
 * the `sets.e1rm_kg` generated column with a `max()`. The column has no idea
 * about `isReliableForStrength`, so a 20-rep back-off set produces an Epley
 * number that is larger than the 5-rep top set and would plot as a PR. Running
 * the domain function here means the phone's chart and the domain layer cannot
 * disagree about what a session was worth — and it is also why a session of
 * nothing but high-rep work drops out entirely instead of plotting a lie.
 *
 * Ordering is `distinct sessions desc, name asc`, so the three rows are stable
 * across refreshes. Without the name tiebreak, two lifts trained the same
 * number of times would swap places between requests.
 */
export async function getMainLiftE1rmSeries(
  userId: string,
  today: string,
  lookbackDays = HISTORY_LOOKBACK_DAYS,
  limit = 3,
): Promise<MainLiftSeries[]> {
  const rows = await db
    .select({
      exerciseId: sets.exerciseId,
      name: exercises.name,
      localDate: workouts.localDate,
      reps: sets.reps,
      weightKg: sets.weightKg,
      isWarmup: sets.isWarmup,
    })
    .from(sets)
    .innerJoin(workouts, eq(workouts.id, sets.workoutId))
    .innerJoin(exercises, eq(exercises.id, sets.exerciseId))
    .where(and(
      eq(workouts.userId, userId),
      eq(workouts.status, "completed"),
      gte(workouts.localDate, shiftDate(today, -lookbackDays)),
    ));

  // (exercise, day) → that day's sets. A day rather than a workout id: two
  // sessions in one day is one data point on a daily axis, and the better of
  // the two is the honest one to plot.
  const byExerciseDay = new Map<string, typeof rows>();
  const names = new Map<string, string>();
  for (const r of rows) {
    names.set(r.exerciseId, r.name);
    const key = `${r.exerciseId}\u0000${r.localDate}`;
    byExerciseDay.set(key, [...(byExerciseDay.get(key) ?? []), r]);
  }

  const series = new Map<string, { date: string; e1rmKg: number }[]>();
  for (const [key, daySets] of byExerciseDay) {
    const best = bestE1rm(daySets);
    if (best === null) continue;
    const [exerciseId, date] = key.split("\u0000");
    series.set(exerciseId, [...(series.get(exerciseId) ?? []), { date, e1rmKg: best }]);
  }

  return [...series.entries()]
    .map(([exerciseId, points]) => ({
      exerciseId,
      name: names.get(exerciseId) ?? "",
      points: points.sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) => b.points.length - a.points.length || a.name.localeCompare(b.name))
    .slice(0, limit);
}

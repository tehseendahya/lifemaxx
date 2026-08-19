import { db } from "@/db";
import {
  meals, mealItems, sets, workouts, exercises, exerciseMuscles,
  bodyMetrics, targets, profiles, activities, gyms, type Muscle, MUSCLES,
} from "@/db/schema";
import { and, desc, eq, gte, sql, inArray } from "drizzle-orm";
import { hardSetsByMuscle, type CountedSet } from "./domain/muscles";
import { rankMuscles, type MuscleState } from "./domain/readiness";
import { estimateTdee, proteinTargetG, WINDOW_DAYS, type WeighIn } from "./domain/tdee";

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

export async function getActiveWorkout(userId: string) {
  const [row] = await db.select().from(workouts)
    .where(and(eq(workouts.userId, userId), eq(workouts.status, "active")))
    .orderBy(desc(workouts.startedAt)).limit(1);
  return row ?? null;
}

export async function getWorkoutSets(workoutId: string) {
  return db
    .select({
      id: sets.id, exerciseId: sets.exerciseId, setIndex: sets.setIndex,
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

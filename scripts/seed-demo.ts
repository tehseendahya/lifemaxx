import "../load-env";
import { adminDb } from "../src/db";
import {
  profiles, meals, mealItems, workouts, sets, exercises, bodyMetrics,
  activities, targets, gyms, coachMessages,
} from "../src/db/schema";
import { eq } from "drizzle-orm";
import { lbToKg } from "../src/lib/domain/units";
import { M_PER_MILE } from "../src/lib/domain/running";

/**
 * A month of plausible data for one user, so the screens can be looked at.
 *
 * Development only — every row is owned by DEMO_USER, and re-running wipes and
 * rebuilds just that user. Nothing here runs in production; there is no npm
 * script wired to it outside local use.
 */

export const DEMO_USER = "0de00000-0000-4000-8000-000000000001";

const day = (offset: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const at = (offset: number, hour: number): Date => {
  const d = new Date(`${day(offset)}T00:00:00Z`);
  d.setUTCHours(hour);
  return d;
};

const MEALS = [
  { slot: "breakfast" as const, note: "3 eggs, 2 toast, black coffee", hour: 12,
    items: [
      { name: "Scrambled eggs", qty: 3, unit: "large", kcal: 215, p: 19, c: 2, f: 15 },
      { name: "Sourdough toast", qty: 2, unit: "slices", kcal: 180, p: 6, c: 34, f: 2 },
      { name: "Butter", qty: 1, unit: "tbsp", kcal: 100, p: 0, c: 0, f: 11 },
    ] },
  { slot: "lunch" as const, note: "chicken thigh not breast, extra rice", hour: 17,
    items: [
      { name: "Chicken thigh", qty: 7, unit: "oz", kcal: 395, p: 44, c: 0, f: 24 },
      { name: "White rice", qty: 1.5, unit: "cups", kcal: 310, p: 6, c: 68, f: 1 },
      { name: "Broccoli", qty: 1, unit: "cup", kcal: 55, p: 4, c: 11, f: 1 },
      { name: "Olive oil", qty: 1, unit: "tbsp", kcal: 120, p: 0, c: 0, f: 14 },
    ] },
  { slot: "dinner" as const, note: "salmon, sweet potato, salad", hour: 23,
    items: [
      { name: "Salmon fillet", qty: 6, unit: "oz", kcal: 350, p: 40, c: 0, f: 20 },
      { name: "Sweet potato", qty: 1, unit: "medium", kcal: 180, p: 4, c: 41, f: 0 },
      { name: "Mixed salad", qty: 2, unit: "cups", kcal: 90, p: 3, c: 8, f: 6 },
    ] },
  { slot: "snack" as const, note: "post-lift shake", hour: 20,
    items: [
      { name: "Whey protein", qty: 1, unit: "scoop", kcal: 130, p: 25, c: 3, f: 2 },
      { name: "Banana", qty: 1, unit: "medium", kcal: 105, p: 1, c: 27, f: 0 },
    ] },
];

/** slug, sets of [reps, lb, rpe] */
const SESSIONS: { offset: number; name: string; lifts: [string, [number, number, number][]][] }[] = [
  { offset: -14, name: "Push — Chest & Triceps", lifts: [
    ["barbell-bench-press", [[5, 175, 7], [5, 175, 7], [5, 175, 8]]],
    ["overhead-press", [[8, 95, 8], [8, 95, 8], [7, 95, 9]]],
  ] },
  { offset: -12, name: "Legs", lifts: [
    ["back-squat", [[5, 245, 8], [5, 245, 8], [5, 245, 9]]],
    ["romanian-deadlift", [[8, 185, 7], [8, 185, 8]]],
  ] },
  { offset: -9, name: "Pull — Back & Biceps", lifts: [
    ["barbell-row", [[8, 155, 7], [8, 155, 8], [8, 155, 8]]],
    ["pull-up", [[9, 0, 8], [8, 0, 9]]],
  ] },
  { offset: -7, name: "Push — Chest & Triceps", lifts: [
    ["barbell-bench-press", [[5, 180, 7], [5, 180, 7], [5, 180, 7]]],
    ["overhead-press", [[8, 100, 8], [8, 100, 8]]],
  ] },
  { offset: -5, name: "Legs", lifts: [
    ["back-squat", [[5, 250, 8], [5, 250, 8], [4, 250, 9]]],
    ["romanian-deadlift", [[8, 195, 8], [8, 195, 8]]],
  ] },
  { offset: -2, name: "Push — Chest & Triceps", lifts: [
    ["barbell-bench-press", [[5, 185, 7], [5, 185, 7], [5, 185, 8]]],
    ["incline-dumbbell-press", [[10, 60, 8], [10, 60, 8]]],
  ] },
];

const RUNS = [
  { offset: -13, name: "Easy 4", mi: 4.0, pace: 545, effort: 40 },
  { offset: -11, name: "Tempo 5", mi: 5.0, pace: 462, effort: 92 },
  { offset: -8, name: "Long run", mi: 9.2, pace: 552, effort: 78 },
  { offset: -6, name: "Easy 4", mi: 4.1, pace: 540, effort: 38 },
  { offset: -4, name: "Intervals 6x800", mi: 5.4, pace: 455, effort: 96 },
  { offset: -1, name: "Long run", mi: 10.1, pace: 548, effort: 84 },
];

async function main() {
  console.log("Rebuilding demo data…");
  await adminDb.delete(profiles).where(eq(profiles.id, DEMO_USER));

  await adminDb.insert(profiles).values({
    id: DEMO_USER,
    email: "demo@lifemaxx.local",
    tz: "America/New_York",
    goalsText:
      "Running prep — half marathon in the fall. Also want to add visible muscle size, especially shoulders and back. And abs.",
    heightCm: 180,
    birthYear: 1998,
  });

  await adminDb.insert(gyms).values({
    userId: DEMO_USER, name: "Planet Fitness — Court St", isDefault: true,
    equipmentNotes: "Dumbbells only to 75lb. No SSB, no reverse hyper. Two squat racks.",
  });

  await adminDb.insert(targets).values({
    userId: DEMO_USER, effectiveFrom: day(-21), mode: "maintain",
    kcal: 2600, proteinG: 165, carbsG: 300, fatG: 80, tdeeEstimate: 2610,
  });

  // Meals, most days, with a couple missed so the coach's "not enough data"
  // rules and the intake gaps are visible.
  for (let offset = -27; offset <= 0; offset++) {
    if (offset % 9 === 0 && offset !== 0) continue;
    const todays = offset === 0 ? MEALS.slice(0, 2) : MEALS;
    for (const m of todays) {
      const totals = m.items.reduce(
        (a, i) => ({ kcal: a.kcal + i.kcal, p: a.p + i.p, c: a.c + i.c, f: a.f + i.f }),
        { kcal: 0, p: 0, c: 0, f: 0 });
      const [meal] = await adminDb.insert(meals).values({
        userId: DEMO_USER, localDate: day(offset), eatenAt: at(offset, m.hour),
        slot: m.slot, note: m.note, source: "photo", confidence: 0.72,
        kcal: totals.kcal, proteinG: totals.p, carbsG: totals.c, fatG: totals.f,
      }).returning();
      await adminDb.insert(mealItems).values(m.items.map((i) => ({
        mealId: meal.id, name: i.name, qty: i.qty, unit: i.unit,
        kcal: i.kcal, proteinG: i.p, carbsG: i.c, fatG: i.f,
      })));
    }
  }

  // Weigh-ins: 3 a week, drifting down slowly, so TDEE clears its 8-sample floor.
  let weight = 182.4;
  for (let offset = -28; offset <= 0; offset++) {
    if (![0, 2, 4].includes(((offset % 7) + 7) % 7)) continue;
    weight -= 0.11 + Math.sin(offset) * 0.18;
    await adminDb.insert(bodyMetrics).values({
      userId: DEMO_USER, localDate: day(offset),
      weightKg: lbToKg(Math.round(weight * 10) / 10), source: "manual",
    }).onConflictDoNothing();
  }

  const catalogue = await adminDb.select().from(exercises);
  const bySlug = new Map(catalogue.map((e) => [e.slug, e]));

  for (const session of SESSIONS) {
    const [workout] = await adminDb.insert(workouts).values({
      userId: DEMO_USER, localDate: day(session.offset), status: "completed",
      startedAt: at(session.offset, 22), endedAt: at(session.offset, 23),
      name: session.name,
    }).returning();

    let index = 0;
    for (const [slug, setList] of session.lifts) {
      const exercise = bySlug.get(slug);
      if (!exercise) { console.warn(`  no catalogue entry for ${slug}, skipping`); continue; }
      for (const [reps, lb, rpe] of setList) {
        index += 1;
        await adminDb.insert(sets).values({
          workoutId: workout.id, exerciseId: exercise.id, setIndex: index,
          reps, weightKg: lbToKg(lb), rpe, restS: 150 + (index % 3) * 30,
          felt: rpe >= 9 ? "weak" : rpe <= 7 ? "strong" : "normal",
          loggedAt: at(session.offset, 22),
        });
      }
    }
  }

  for (const run of RUNS) {
    await adminDb.insert(activities).values({
      userId: DEMO_USER, provider: "strava", externalId: `demo-${run.offset}`,
      type: "Run", name: run.name,
      startedAt: at(run.offset, 11), localDate: day(run.offset),
      durationS: Math.round(run.mi * run.pace),
      distanceM: run.mi * M_PER_MILE,
      elevationM: 30 + Math.abs(run.offset) * 4,
      avgHr: 142 + Math.round(run.effort / 6),
      kcal: Math.round(run.mi * 105),
      sufferScore: run.effort,
    }).onConflictDoNothing();
  }

  await adminDb.insert(coachMessages).values([
    { userId: DEMO_USER, role: "user",
      content: "am I actually progressing on bench or just adding volume?",
      createdAt: at(-2, 20) },
    { userId: DEMO_USER, role: "assistant",
      content: "Bench e1RM is up 5.7% in three weeks — 175x5 @RPE7 to 185x5 @RPE7 at the same effort. That's progression, not volume. Keep the increment at 5lb; you haven't earned a bigger jump yet.",
      createdAt: at(-2, 20) },
  ]);

  console.log(`Done. Demo user ${DEMO_USER}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });

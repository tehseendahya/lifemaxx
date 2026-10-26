import type { Bootstrap, HistoryDay, RankedMuscle, RunDto } from "../../lib/types";

/**
 * Test-only builders for the Today dashboard.
 *
 * A module rather than a block copied into three test files. `model.test.ts`,
 * `verdict.test.ts` and `goals.test.ts` all need a complete `Bootstrap`, and a
 * fixture that is one field out of date in one of three copies is
 * indistinguishable from a real failure until someone diffs them.
 *
 * Not imported by any screen, so it never reaches the bundle: Metro builds from
 * the entry graph, and nothing in `app/` reaches here.
 *
 * `TODAY` is a Sunday, which matters: the ISO week containing it starts
 * 2026-10-19, so the eight load buckets run 2026-08-31 … 2026-10-19 and the
 * current week is the partial one.
 */

export const TODAY = "2026-10-25";

export function day(date: string, over: Partial<HistoryDay> = {}): HistoryDay {
  return { date, weightLb: null, kcal: null, hardSets: 0, ...over };
}

/**
 * Eight lift days inside the 28-day window, which is what clears the verdict's
 * thin-data rung. Every test that wants to reach rungs 2-6 needs this.
 */
export function liftHistory(): HistoryDay[] {
  return ["2026-10-08", "2026-10-10", "2026-10-13", "2026-10-15", "2026-10-17",
    "2026-10-20", "2026-10-22", "2026-10-24"]
    .map((d) => day(d, { hardSets: 18 }));
}

export function ranked(over: Partial<RankedMuscle> = {}): RankedMuscle {
  return {
    muscle: "rear_delt",
    label: "Rear Delts",
    setsLast7d: 0,
    daysSinceTrained: 9,
    score: 1,
    ...over,
  };
}

export function run(over: Partial<RunDto> = {}): RunDto {
  return {
    id: "r1",
    localDate: "2026-10-24",
    startedAt: "2026-10-24T11:00:00.000Z",
    name: "Morning run",
    type: "Run",
    distanceM: 8046.72, // 5.0 mi
    durationS: 2610, // 8:42/mi
    elevationM: 30,
    avgHr: 150,
    sufferScore: 40,
    verdict: null,
    ...over,
  };
}

export function bootstrap(over: Partial<Bootstrap> = {}): Bootstrap {
  return {
    today: TODAY,
    tz: "America/New_York",
    goalsText: "",
    target: { kcal: 2600, proteinG: 165, carbsG: 300, fatG: 80, mode: "maintain" },
    totals: { kcal: 1375.4, proteinG: 79, carbsG: 115, fatG: 68 },
    mealCount: 2,
    volume: {
      summary: "Rear Delts and Lats are owed sets this week.",
      ranked: [
        ranked(),
        ranked({ muscle: "lat", label: "Lats", setsLast7d: 1.5, daysSinceTrained: 5, score: 0.765 }),
        ranked({ muscle: "chest", label: "Chest", setsLast7d: 8, daysSinceTrained: 2, score: 0.2001 }),
        ranked({ muscle: "quad", label: "Quads", setsLast7d: 12, daysSinceTrained: 1, score: 0.05 }),
      ],
    },
    tdee: {
      status: "ok",
      tdee: 2377,
      marginKcal: 11,
      trendKgPerWeek: -0.16431483055858312, // −0.36 lb/wk
      currentKg: 82.08537140127595, // 180.96 lb
      meanIntake: 2196,
      weighIns: 13,
    },
    activeWorkout: null,
    runs: [],
    lowerBodyLiftDates: [],
    gyms: [],
    catalogue: [],
    lastSets: {},
    history: { days: liftHistory(), mainLifts: [] },
    ...over,
  };
}

/** The 147-entry catalogue is not needed here; these are the rows goals match. */
export const CATALOGUE = [
  cat("ex-bench", "Barbell Bench Press"),
  cat("ex-incline", "Barbell Incline Press"),
  cat("ex-smith-incline", "Smith Machine Incline Press"),
  cat("ex-squat", "Barbell Back Squat"),
  cat("ex-dl", "Barbell Deadlift"),
  cat("ex-preacher", "Preacher Curl"),
  cat("ex-ohp", "Barbell Overhead Press"),
];

function cat(id: string, name: string) {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    incrementLb: 5,
    equipment: "barbell",
    muscles: [],
  };
}

/**
 * A brand-new account, the way the server actually sends it on first launch.
 *
 * Every array empty, no target, calibrating, nothing eaten. `volume.ranked` is
 * NOT empty, because it is not on a real day one either: `rankMuscles` returns
 * every muscle with `daysSinceTrained: null` and a score of 1. A cold-start
 * test with an empty ranking would pass for the wrong reason — the hero's owed
 * chips are hidden on day one because rung 1 answered, not because nothing
 * was ranked.
 */
export function emptyBootstrap(over: Partial<Bootstrap> = {}): Bootstrap {
  return bootstrap({
    goalsText: "",
    target: { kcal: null, proteinG: 150, carbsG: null, fatG: null, mode: "calibrating" },
    totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    mealCount: 0,
    volume: {
      summary: "",
      ranked: [
        ranked({ muscle: "chest", label: "Chest", daysSinceTrained: null, score: 1 }),
        ranked({ muscle: "lat", label: "Lats", daysSinceTrained: null, score: 1 }),
      ],
    },
    tdee: { status: "insufficient_data", weighIns: 0, needed: 8 },
    activeWorkout: null,
    runs: [],
    lowerBodyLiftDates: [],
    lastSets: {},
    history: { days: [], mainLifts: [] },
    ...over,
  });
}

/**
 * Day three of the habit: three weigh-ins, two days of food, nothing lifted.
 *
 * The state the redesign's acceptance names — Body has enough for a partial
 * card, maintenance is 3 of 8 weigh-ins and 2 of 7 food days.
 */
export function threeWeighIns(over: Partial<Bootstrap> = {}): Bootstrap {
  return emptyBootstrap({
    tdee: { status: "insufficient_data", weighIns: 3, needed: 8 },
    history: {
      days: [
        day("2026-10-23", { weightLb: 183, kcal: 2400 }),
        day("2026-10-24", { weightLb: 182, kcal: 2250 }),
        day("2026-10-25", { weightLb: 182 }),
      ],
      mainLifts: [],
    },
    ...over,
  });
}

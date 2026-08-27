import type { Muscle } from "@/db/schema";

/**
 * Running, as a first-class goal rather than context for something else.
 *
 * The Strava pull was already storing activities and handing them to the coach
 * as raw rows. Nothing computed anything from them, so nothing could be shown.
 * This is the arithmetic: pace, weekly mileage, whether the pace is actually
 * moving, and whether the running load is landing on top of the lifting load.
 *
 * Pure, like the rest of the domain layer — no I/O, so it runs offline and is
 * covered by tests that need neither a database nor a model.
 *
 * Distances are stored in metres and displayed in miles, for the same reason
 * weights are stored in kg and displayed in lb: the storage unit should stay
 * metric, and the person reading it thinks in miles.
 */

export const M_PER_MILE = 1609.344;
export const M_PER_FOOT = 0.3048;

/** Strava sport_type values that are runs. Rides and swims are not. */
const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun", "Treadmill"]);
export const isRun = (type: string): boolean => RUN_TYPES.has(type);

/**
 * Below this, a "run" is a warmup, a cooldown or a mis-tagged walk to the car,
 * and letting it into a pace average makes the average meaningless.
 */
export const PACE_MIN_DISTANCE_MI = 2;

/** At this distance the run is the week's long run regardless of pace. */
export const LONG_RUN_MI = 8;

/** How much faster than baseline pace counts as a hard effort. */
export const HARD_PACE_MARGIN = 0.04;

/** Strava's own relative effort. Its scale runs to ~150; 80 is a real session. */
export const HARD_SUFFER_SCORE = 80;

export interface Run {
  /** ISO date in the user's timezone, YYYY-MM-DD. */
  localDate: string;
  name: string;
  type: string;
  distanceM: number | null;
  durationS: number;
  elevationM: number | null;
  avgHr: number | null;
  sufferScore: number | null;
}

export const miles = (m: number): number => m / M_PER_MILE;
export const feet = (m: number): number => m / M_PER_FOOT;

/** Seconds per mile, or null when there is no distance to divide by. */
export function paceSecPerMile(distanceM: number | null, durationS: number): number | null {
  if (!distanceM || distanceM <= 0 || durationS <= 0) return null;
  return durationS / miles(distanceM);
}

/** "8:42". Rounds to the second, because nobody paces to a tenth. */
export function formatPace(secPerMile: number | null): string {
  if (secPerMile === null || !Number.isFinite(secPerMile) || secPerMile <= 0) return "—";
  const total = Math.round(secPerMile);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export type RunEffort = "easy" | "hard" | "long";

/**
 * How hard the run was, from what Strava actually gives us.
 *
 * Ordering matters: a long run is classified as long even when it is also fast,
 * because for interference purposes the distance is what did the damage.
 */
export function classifyRun(run: Run, baselinePaceSecPerMile: number | null): RunEffort {
  if (run.distanceM && miles(run.distanceM) >= LONG_RUN_MI) return "long";
  if (run.sufferScore !== null && run.sufferScore >= HARD_SUFFER_SCORE) return "hard";

  const pace = paceSecPerMile(run.distanceM, run.durationS);
  if (pace !== null && baselinePaceSecPerMile !== null) {
    if (pace <= baselinePaceSecPerMile * (1 - HARD_PACE_MARGIN)) return "hard";
  }
  return "easy";
}

/** Distance-weighted average pace over the runs long enough to mean anything. */
export function averagePaceSecPerMile(runs: Run[]): number | null {
  const usable = runs.filter((r) => r.distanceM && miles(r.distanceM) >= PACE_MIN_DISTANCE_MI);
  const distance = usable.reduce((s, r) => s + (r.distanceM ?? 0), 0);
  const duration = usable.reduce((s, r) => s + r.durationS, 0);
  if (distance <= 0 || duration <= 0) return null;
  return duration / miles(distance);
}

export interface WeekStats {
  /** Monday, ISO. */
  weekStart: string;
  runs: number;
  distanceMi: number;
  durationMin: number;
  elevationFt: number;
  avgPaceSecPerMile: number | null;
  longestRunMi: number;
  hardOrLongRuns: number;
}

/** Monday of the week containing `iso`. */
export function weekStartOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  // getUTCDay is 0 for Sunday; shift so Monday is the start.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function weeklyRunStats(runs: Run[], weekStart: string): WeekStats {
  const inWeek = runs.filter((r) => weekStartOf(r.localDate) === weekStart);
  const distanceM = inWeek.reduce((s, r) => s + (r.distanceM ?? 0), 0);
  const baseline = averagePaceSecPerMile(runs);

  return {
    weekStart,
    runs: inWeek.length,
    distanceMi: round1(miles(distanceM)),
    durationMin: Math.round(inWeek.reduce((s, r) => s + r.durationS, 0) / 60),
    elevationFt: Math.round(feet(inWeek.reduce((s, r) => s + (r.elevationM ?? 0), 0))),
    avgPaceSecPerMile: averagePaceSecPerMile(inWeek),
    longestRunMi: round1(miles(Math.max(0, ...inWeek.map((r) => r.distanceM ?? 0)))),
    hardOrLongRuns: inWeek.filter((r) => classifyRun(r, baseline) !== "easy").length,
  };
}

export interface PaceTrend {
  /** Seconds per mile gained or lost per week. Negative means getting faster. */
  secPerMilePerWeek: number;
  runsUsed: number;
  /** False when the sample is too thin to call, which is most of month one. */
  reliable: boolean;
}

/**
 * Least-squares of pace against date, for the same reason TDEE regresses rather
 * than averaging: runs are not evenly spaced, and comparing "this week's
 * average" to "last week's" reads a rest week as a collapse in fitness.
 *
 * Only runs past PACE_MIN_DISTANCE_MI are used. A 1-mile shakeout at 10:30 is
 * not evidence that the person got slower.
 */
export const MIN_RUNS_FOR_TREND = 5;

export function paceTrend(runs: Run[]): PaceTrend | null {
  const points = runs
    .filter((r) => r.distanceM && miles(r.distanceM) >= PACE_MIN_DISTANCE_MI)
    .map((r) => ({ x: Date.parse(`${r.localDate}T00:00:00Z`) / 86_400_000, y: paceSecPerMile(r.distanceM, r.durationS) }))
    .filter((p): p is { x: number; y: number } => p.y !== null)
    .sort((a, b) => a.x - b.x);

  if (points.length < 2) return null;

  const meanX = points.reduce((s, p) => s + p.x, 0) / points.length;
  const meanY = points.reduce((s, p) => s + p.y, 0) / points.length;

  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - meanX) ** 2;
    sxy += (p.x - meanX) * (p.y - meanY);
  }
  if (sxx === 0) return null;

  return {
    secPerMilePerWeek: (sxy / sxx) * 7,
    runsUsed: points.length,
    reliable: points.length >= MIN_RUNS_FOR_TREND,
  };
}

export const LOWER_BODY: Muscle[] = ["quad", "hamstring", "glute", "calf", "adductor", "abductor"];

export interface InterferenceHit {
  runDate: string;
  liftDate: string;
  effort: RunEffort;
  /** Negative when the lift came first. */
  daysApart: number;
}

/**
 * Hard running and hard lower-body lifting inside 24 hours of each other.
 *
 * This is the one thing a coach can say that a calorie app cannot, and it is
 * only computable because the app holds both sides. Easy runs are excluded on
 * purpose — easy mileage next to a squat day is the plan working, not a
 * conflict.
 */
export function detectInterference(
  runs: Run[],
  lowerBodyLiftDates: string[],
  baselinePaceSecPerMile: number | null = null,
): InterferenceHit[] {
  const baseline = baselinePaceSecPerMile ?? averagePaceSecPerMile(runs);
  const liftDays = [...new Set(lowerBodyLiftDates)];
  const hits: InterferenceHit[] = [];

  for (const run of runs) {
    const effort = classifyRun(run, baseline);
    if (effort === "easy") continue;

    const runDay = Date.parse(`${run.localDate}T00:00:00Z`) / 86_400_000;
    for (const liftDate of liftDays) {
      const liftDay = Date.parse(`${liftDate}T00:00:00Z`) / 86_400_000;
      const daysApart = liftDay - runDay;
      if (Math.abs(daysApart) <= 1) {
        hits.push({ runDate: run.localDate, liftDate, effort, daysApart });
      }
    }
  }

  return hits.sort((a, b) => a.runDate.localeCompare(b.runDate));
}

/** Everything the weekly rollup needs, in one deterministic object. */
export interface RunningWeek {
  thisWeek: WeekStats;
  lastWeek: WeekStats;
  trend: PaceTrend | null;
  interference: InterferenceHit[];
  /** Total across the whole lookback, so "mileage is building" is checkable. */
  totalMi: number;
}

export function summarizeRunningWeek(
  runs: Run[],
  lowerBodyLiftDates: string[],
  weekStart: string,
): RunningWeek {
  const previous = new Date(`${weekStart}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 7);
  const lastWeekStart = previous.toISOString().slice(0, 10);

  return {
    thisWeek: weeklyRunStats(runs, weekStart),
    lastWeek: weeklyRunStats(runs, lastWeekStart),
    trend: paceTrend(runs),
    interference: detectInterference(
      runs.filter((r) => weekStartOf(r.localDate) === weekStart),
      lowerBodyLiftDates,
      averagePaceSecPerMile(runs),
    ),
    totalMi: round1(miles(runs.reduce((s, r) => s + (r.distanceM ?? 0), 0))),
  };
}

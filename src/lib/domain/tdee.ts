/**
 * Adaptive TDEE.
 *
 * Maintenance is measured, not guessed: whatever you ate, plus whatever the
 * scale did about it. This also cancels systematic logging error — if the vision
 * model reads every meal 15% low, the computed TDEE comes out 15% low too and
 * the target it hands back is still correct.
 *
 * Built for 2-3 weigh-ins a week, which drives two decisions:
 *
 *  1. Least-squares regression on (date, weight), NOT an exponential moving
 *     average. An EMA silently assumes evenly spaced samples — give it Mon,
 *     Thu, Sun and it weights them as though they were consecutive, biasing the
 *     trend toward whichever day you weigh in most. Regression doesn't care
 *     about spacing and returns a standard error for free.
 *  2. A hard minimum sample count. Below it we say so instead of inventing a
 *     number, which is the same rule the coach follows.
 */

export const KCAL_PER_KG_BODY_MASS = 7700;
export const WINDOW_DAYS = 28;
export const MIN_WEIGH_INS = 8;

export interface WeighIn {
  /** ISO date, YYYY-MM-DD. */
  localDate: string;
  weightKg: number;
}

export interface TrendResult {
  /** kg per day. Negative means losing. */
  slopeKgPerDay: number;
  /** Fitted weight at the most recent date — less noisy than the raw reading. */
  currentKg: number;
  /** Standard error of the slope, kg/day. Becomes the confidence range. */
  slopeStdErr: number;
  n: number;
}

const dayNumber = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/** Ordinary least squares of weight against day number. */
export function weightTrend(weighIns: WeighIn[]): TrendResult | null {
  const points = weighIns
    .filter((w) => Number.isFinite(w.weightKg) && w.weightKg > 0)
    .map((w) => ({ x: dayNumber(w.localDate), y: w.weightKg }))
    .sort((a, b) => a.x - b.x);

  const n = points.length;
  if (n < 2) return null;

  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;

  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - meanX) ** 2;
    sxy += (p.x - meanX) * (p.y - meanY);
  }
  // Every weigh-in on the same day — no slope is derivable.
  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  let sse = 0;
  for (const p of points) sse += (p.y - (slope * p.x + intercept)) ** 2;
  const slopeStdErr = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : 0;

  const lastX = points[n - 1].x;
  return { slopeKgPerDay: slope, currentKg: slope * lastX + intercept, slopeStdErr, n };
}

export type TdeeResult =
  | { status: "insufficient_data"; weighIns: number; needed: number }
  | {
      status: "ok";
      tdee: number;
      /** ± this many kcal, from the regression's standard error. */
      marginKcal: number;
      trendKgPerWeek: number;
      currentKg: number;
      meanIntake: number;
      weighIns: number;
    };

export interface DailyIntake {
  localDate: string;
  kcal: number;
}

export function estimateTdee(weighIns: WeighIn[], intake: DailyIntake[]): TdeeResult {
  const usableIntake = intake.filter((d) => d.kcal > 0);

  if (weighIns.length < MIN_WEIGH_INS || usableIntake.length < 7) {
    return { status: "insufficient_data", weighIns: weighIns.length, needed: MIN_WEIGH_INS };
  }

  const trend = weightTrend(weighIns);
  if (!trend) {
    return { status: "insufficient_data", weighIns: weighIns.length, needed: MIN_WEIGH_INS };
  }

  const meanIntake = usableIntake.reduce((s, d) => s + d.kcal, 0) / usableIntake.length;
  const tdee = meanIntake - trend.slopeKgPerDay * KCAL_PER_KG_BODY_MASS;

  return {
    status: "ok",
    tdee: Math.round(tdee),
    marginKcal: Math.round(trend.slopeStdErr * KCAL_PER_KG_BODY_MASS),
    trendKgPerWeek: trend.slopeKgPerDay * 7,
    currentKg: trend.currentKg,
    meanIntake: Math.round(meanIntake),
    weighIns: weighIns.length,
  };
}

/**
 * Targets proposed once calibration completes. Deliberately conservative:
 * ~0.5% bodyweight per week either direction is the rate you can actually hold.
 */
export function proposeTargets(tdee: number, bodyweightKg: number) {
  const weeklyPct = 0.005;
  const dailyDelta = (bodyweightKg * weeklyPct * KCAL_PER_KG_BODY_MASS) / 7;
  return {
    cut: Math.round((tdee - dailyDelta) / 10) * 10,
    maintain: Math.round(tdee / 10) * 10,
    bulk: Math.round((tdee + dailyDelta * 0.6) / 10) * 10,
  };
}

/**
 * Protein is targeted from day one because it's the one number that's right
 * regardless of which way you eventually go. 1.8 g/kg sits mid-range.
 */
export const proteinTargetG = (bodyweightKg: number): number =>
  Math.round(bodyweightKg * 1.8);

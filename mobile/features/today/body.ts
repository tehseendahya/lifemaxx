/*
 * Relative imports, same reason as `model.ts`: this module has to run under the
 * node-environment vitest config, so it stays free of `react-native` and of
 * build configuration.
 */
import { KCAL_PER_KG_BODY_MASS, weightTrend } from "../../lib/shared/tdee";
import { kgToLb } from "../../lib/shared/units";
import type { Bootstrap } from "../../lib/types";
import { extractGoalClaims } from "./goals";
import {
  MIN_INTAKE_DAYS_FOR_MEAN, MIN_WEIGH_INS_FOR_TREND, TRAJECTORY_DAYS, currentWeightLb,
  shiftIso, signed, trajectory, withinDays,
} from "./model";
import type { WeightPanel } from "./model";

/**
 * The Body card: where the scale is going, and — once it is measured — what
 * the food is doing to it.
 *
 * This replaces the old Trajectory card, which drew two stacked panels from day
 * one: a bodyweight frame with one dot or none, and an intake sparkline against
 * a maintenance line that did not exist yet. That was the "odd empty graphs"
 * the owner named. The fix is not a better empty frame but no frame:
 *
 *  - Below two weigh-ins in 28 days the card is absent, and the Unlocking card
 *    says "1 of 2 weigh-ins" instead.
 *  - From two weigh-ins it is one chart (dots + fitted line, the existing
 *    `WeightChart`) under a trend weight and a rate. MacroFactor's choice, and
 *    the right one: the trend weight is the headline, not the last reading,
 *    because a single morning is ±2 lb of water.
 *  - Once maintenance is measured, it joins the stat row and the intake panel
 *    becomes ONE sentence. A second chart in a second unit was the other half
 *    of the clutter, and "eating 2200 against 2380" is what it was trying to
 *    say.
 *
 * Built on `trajectory()` from `model.ts` rather than beside it, so the chart
 * and the rate figure come from the same fit and cannot disagree.
 */

/**
 * The intake sentence's window. Completed days only: today is half-eaten, and a
 * half-eaten day against a full day's maintenance reads as a deficit that is
 * not there.
 */
export const BODY_INTAKE_DAYS = 7;

/**
 * Below this many kcal/day of difference, the sentence does not call a
 * contradiction. A 40 kcal surplus on a cut is logging noise, not a direction,
 * and colouring it warn would be the app nagging about rounding.
 */
const CONTRADICTION_KCAL = 50;

export interface BodyStat {
  label: string;
  value: string;
  hint?: string;
}

export interface BodyCard {
  /** `partial` until TDEE is measured, `full` after. */
  mode: "partial" | "full";
  label: string;
  stats: BodyStat[];
  chart: WeightPanel;
  xLabels: { left: string; right: string };
  /** Full mode only, and only with enough intake to average. */
  sentence: { text: string; tone: "muted" | "warn" } | null;
}

/** One decimal, always — the stat row is a column of figures. */
const lb1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

/**
 * The trend weight, in lb.
 *
 * The server's fitted value when TDEE is measured (the same number You and the
 * goal rows use). Before that, the same `weightTrend` fit run on the phone over
 * the Body chart's own weigh-ins — fed pounds, which is sound because OLS is
 * scale-equivariant, so the fitted value comes back in pounds.
 */
export function trendWeightLb(b: Bootstrap): number | null {
  if (b.tdee.status === "ok") return kgToLb(b.tdee.currentKg);

  const weighIns = withinDays(b.history.days, b.today, TRAJECTORY_DAYS)
    .filter((d) => d.weightLb !== null);
  const fit = weightTrend(
    weighIns.map((d) => ({ localDate: d.date, weightKg: d.weightLb as number })),
  );
  return fit !== null ? fit.currentKg : currentWeightLb(b);
}

/**
 * Mean intake over the last seven COMPLETED days, or null below three logged.
 *
 * Unlogged days are excluded, not counted as zero — a skipped log is not a
 * fast. Three is `MIN_INTAKE_DAYS_FOR_MEAN`, the floor the old intake panel
 * used before it would draw a mean at all.
 */
export function recentIntakeMean(b: Bootstrap): number | null {
  const yesterday = shiftIso(b.today, -1);
  const logged = withinDays(b.history.days, yesterday, BODY_INTAKE_DAYS)
    .filter((d) => d.kcal !== null && d.kcal > 0)
    .map((d) => d.kcal as number);
  if (logged.length < MIN_INTAKE_DAYS_FOR_MEAN) return null;
  return Math.round(logged.reduce((s, k) => s + k, 0) / logged.length);
}

/**
 * Which way the owner's bodyweight goal points, if they wrote one: −1 to lose,
 * +1 to gain, 0 for none (or none measurable yet).
 *
 * The first bodyweight claim decides. Two contradictory bodyweight goals in one
 * box is a typo, and the sentence is only coloured, never reworded, by this.
 */
export function bodyweightGoalDirection(b: Bootstrap): -1 | 0 | 1 {
  const claim = extractGoalClaims(b.goalsText, b.catalogue, b.today).claims
    .find((c) => c.kind === "bodyweight");
  const now = currentWeightLb(b);
  if (claim === undefined || claim.kind !== "bodyweight" || now === null) return 0;

  const delta = claim.targetLb - now;
  if (Math.abs(delta) < 1) return 0;
  return delta > 0 ? 1 : -1;
}

/** The Body card, or null when there are fewer than two weigh-ins in 28 days. */
export function bodyCard(b: Bootstrap): BodyCard | null {
  const t = trajectory(b);
  if (t.weight === null || t.weight.values.length < MIN_WEIGH_INS_FOR_TREND) return null;

  const trend = trendWeightLb(b);
  const stats: BodyStat[] = [
    { label: "TREND WEIGHT", value: trend === null ? "—" : `${lb1(trend)} lb` },
    { label: "RATE", value: t.trendLabel ?? "—" },
  ];

  if (b.tdee.status !== "ok") {
    return {
      mode: "partial",
      label: "Body · 28 days",
      stats,
      chart: t.weight,
      xLabels: t.xLabels,
      sentence: null,
    };
  }

  stats.push({
    label: "MAINTENANCE",
    value: String(b.tdee.tdee),
    hint: `±${b.tdee.marginKcal}`,
  });

  return {
    mode: "full",
    label: "Body · 28 days",
    stats,
    chart: t.weight,
    xLabels: t.xLabels,
    sentence: intakeSentence(b, b.tdee.tdee),
  };
}

/**
 * "Eating 2196 a day against 2377 maintenance, −181 kcal/day, about −0.4 lb/wk."
 *
 * The lb/wk is the inverse of the TDEE estimate's own arithmetic
 * (`KCAL_PER_KG_BODY_MASS`), so the rate it implies is the rate the regression
 * would agree with. Muted by default — it is a reading, not a verdict — and
 * warn only when it points the opposite way to a bodyweight goal the owner
 * actually wrote down. With no such goal there is no "wrong" direction to warn
 * about, and the app does not pick one.
 */
export function intakeSentence(
  b: Bootstrap,
  tdee: number,
): { text: string; tone: "muted" | "warn" } | null {
  const mean = recentIntakeMean(b);
  if (mean === null) return null;

  const diff = mean - tdee;
  const lbPerWeek = kgToLb((diff * 7) / KCAL_PER_KG_BODY_MASS);

  const goal = bodyweightGoalDirection(b);
  const contradicts = goal !== 0
    && Math.abs(diff) >= CONTRADICTION_KCAL
    && Math.sign(diff) !== goal;

  return {
    text: `Eating ${mean} a day against ${tdee} maintenance, ${signed(diff)} kcal/day, `
      + `about ${signed(lbPerWeek, 1)} lb/wk.`,
    tone: contradicts ? "warn" : "muted",
  };
}

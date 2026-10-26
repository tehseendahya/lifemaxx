/*
 * Relative imports, same reason as `model.ts`: this module has to run under the
 * node-environment vitest config, so it stays free of `react-native` and of
 * build configuration.
 */
import { MIN_WEIGH_INS, WINDOW_DAYS } from "../../lib/shared/tdee";
import type { Bootstrap } from "../../lib/types";
import {
  MIN_WEIGH_INS_FOR_TREND, TDEE_INTAKE_DAYS_NEEDED, TRAJECTORY_DAYS, intakeDaysIn,
  loadBlock, plural, withinDays,
} from "./model";

/**
 * What Today shows before there is enough data to show it — and the rule for
 * when each card is allowed to appear at all.
 *
 * The owner's complaint about the cold-start screen was exact: "odd empty
 * graphs in the trajectory box". A chart frame with nothing in it, or a
 * one-point "trend", reads as a broken screen on the one page that is meant to
 * be enticing. So the rule here is the Whoop/Oura "learning your baseline"
 * pattern: a card appears when it has something true to say, and until then
 * the thing it WILL show is one row in a single Unlocking card, with a count
 * and the tap that moves the count.
 *
 * Both halves live in this one module on purpose. `cardVisibility` decides
 * when a card renders and `unlockRows` decides when its row disappears, and
 * they are the same threshold read from opposite sides. Two files would let
 * them drift — a card that appears while its Unlocking row is still showing,
 * or worse, neither.
 */

/**
 * The server's TDEE window, as a count of days inclusive of today.
 *
 * `getTdee` reads from `today − 28` through today, which is 29 calendar days,
 * while the Body chart's own window (`TRAJECTORY_DAYS`) is 28. The food-day
 * count below has to be the server's, not the chart's: it is printed beside a
 * weigh-in count that comes straight from `tdee.weighIns`, and a phone that
 * counts one fewer day than the server would show "7 of 7 food days" under a
 * status that is still insufficient.
 */
export const TDEE_WINDOW_DAYS = WINDOW_DAYS + 1;

/** One dot track: `have` of `need`, clamped so 9 of 8 never renders. */
export interface Track {
  have: number;
  need: number;
}

/** Where tapping a row goes. The screen maps these to a pad or a route. */
export type UnlockAction = "weigh" | "food" | "lift";

export type UnlockKey = "weight" | "maintenance" | "strength" | "volume";

export interface UnlockRow {
  key: UnlockKey;
  title: string;
  /** The progress line under the title. Exact copy, asserted in the tests. */
  progress: string;
  /** One track for most rows, two for maintenance (weigh-ins and food days). */
  tracks: Track[];
  action: UnlockAction;
}

export interface CalibrationView {
  weighIns: Track;
  foodDays: Track;
  /** "3 of 8 weigh-ins · 2 of 7 food days" */
  progress: string;
  /** The muted line under the tracks. */
  footer: string;
  /** Where the next tap should go: whichever count is still short. */
  action: "weigh" | "food";
}

export interface UnlockCard {
  rows: UnlockRow[];
  /** "2 OF 4 READY" — the right-aligned micro-label. */
  readyLabel: string;
  /** Only while maintenance is still locked. */
  footer: string | null;
}

export interface CardVisibility {
  unlocking: boolean;
  body: boolean;
  goals: true;
  bigLifts: boolean;
  setsPerMuscle: boolean;
  thisMonth: boolean;
  runMiles: boolean;
}

/** The four things that unlock. A fixed list, so "n OF 4" is never a guess. */
const UNLOCK_TOTAL = 4;

// --------------------------------------------------------------- the counts

/** Weigh-ins in the Body chart's 28-day window — what the chart would plot. */
export const weighInsInWindow = (b: Bootstrap): number =>
  withinDays(b.history.days, b.today, TRAJECTORY_DAYS).filter((d) => d.weightLb !== null).length;

/** Any e1RM point at all. After WS2 the server sends only barbell main lifts. */
const hasStrengthPoint = (b: Bootstrap): boolean =>
  b.history.mainLifts.some((l) => l.points.length > 0);

/** Any working set in the 56-day history. */
const hasLifted = (b: Bootstrap): boolean => b.history.days.some((d) => d.hardSets > 0);

/**
 * Days until maintenance can be measured, if every day from here is logged.
 *
 * The larger of the two shortfalls, because both floors have to clear and a
 * day can count toward both at once (weigh in AND log food). Clamped at zero:
 * once both counts are met the remaining blocker is the spread of the data,
 * which no number of days-from-now honestly describes.
 */
export function daysToCalibrate(weighIns: number, foodDays: number): number {
  return Math.max(MIN_WEIGH_INS - weighIns, TDEE_INTAKE_DAYS_NEEDED - foodDays, 0);
}

/**
 * The calibration progress, or null once maintenance is measured.
 *
 * Shared by Today's Unlocking card (its Maintenance row) and You (where it
 * replaces the maintenance number until there is one). One function, so the
 * two screens cannot print different counts for the same thing.
 *
 * The weigh-in count is the server's `tdee.weighIns` rather than one counted on
 * the phone: it is the exact number the regression's floor is checked against,
 * so it is the one that can honestly be printed as "of 8".
 */
export function calibrationView(b: Bootstrap): CalibrationView | null {
  if (b.tdee.status === "ok") return null;

  const w = b.tdee.weighIns;
  const f = intakeDaysIn(b.history.days, b.today, TDEE_WINDOW_DAYS);
  const need = b.tdee.needed;
  const d = daysToCalibrate(w, f);

  return {
    weighIns: { have: Math.min(w, need), need },
    foodDays: { have: Math.min(f, TDEE_INTAKE_DAYS_NEEDED), need: TDEE_INTAKE_DAYS_NEEDED },
    progress: `${Math.min(w, need)} of ${need} weigh-ins · `
      + `${Math.min(f, TDEE_INTAKE_DAYS_NEEDED)} of ${TDEE_INTAKE_DAYS_NEEDED} food days`,
    footer: d > 0
      ? `About ${plural(d, "more day")} of weighing in and logging food until your real `
        + "maintenance number. Then calorie targets switch on."
      /*
       * Both floors met and still insufficient. The regression needs its points
       * spread across the window — eight weigh-ins on three consecutive days
       * have no slope worth fitting — and saying "0 more days" here would be a
       * promise the next refetch breaks.
       */
      : "Counts are in. Needs a few more days spread across the window to fit a trend.",
    // Weigh-ins first: they are the slower count to build (one a day, mornings
    // only) and the one this screen can fill in place without leaving.
    action: w < need ? "weigh" : "food",
  };
}

// ------------------------------------------------------------- the rows

/**
 * The locked rows, in a fixed order, and only the locked ones.
 *
 * A row disappears the moment its card can render — the thresholds here are
 * `cardVisibility`'s, read from the other side, and `unlock.test.ts` asserts
 * the two never overlap and never leave a gap.
 */
export function unlockRows(b: Bootstrap): UnlockRow[] {
  const rows: UnlockRow[] = [];

  const w28 = weighInsInWindow(b);
  if (w28 < MIN_WEIGH_INS_FOR_TREND) {
    rows.push({
      key: "weight",
      title: "Weight trend",
      progress: `${w28} of ${MIN_WEIGH_INS_FOR_TREND} weigh-ins`,
      tracks: [{ have: w28, need: MIN_WEIGH_INS_FOR_TREND }],
      action: "weigh",
    });
  }

  const cal = calibrationView(b);
  if (cal !== null) {
    rows.push({
      key: "maintenance",
      title: "Maintenance calories",
      progress: cal.progress,
      tracks: [cal.weighIns, cal.foodDays],
      action: cal.action,
    });
  }

  if (!hasStrengthPoint(b)) {
    rows.push({
      key: "strength",
      title: "Strength trend",
      progress: "Log a bench, squat, deadlift or overhead press",
      tracks: [{ have: 0, need: 1 }],
      action: "lift",
    });
  }

  if (!hasLifted(b)) {
    rows.push({
      key: "volume",
      title: "Sets per muscle",
      progress: "Log one session",
      tracks: [{ have: 0, need: 1 }],
      action: "lift",
    });
  }

  return rows;
}

/** The Unlocking card, or null when everything has unlocked. */
export function unlockCard(b: Bootstrap): UnlockCard | null {
  const rows = unlockRows(b);
  if (rows.length === 0) return null;

  const cal = calibrationView(b);
  return {
    rows,
    readyLabel: `${UNLOCK_TOTAL - rows.length} OF ${UNLOCK_TOTAL} READY`,
    footer: cal === null ? null : cal.footer,
  };
}

// ------------------------------------------------------------- visibility

/**
 * Which progress cards render. The appear thresholds of §3.1, in one place.
 *
 * Goals always renders: with nothing written it is the invitation to write
 * something, which is itself the next tap. Every other card is absent rather
 * than empty below its threshold — there is no "No runs logged" card, no frame
 * around zero weigh-ins.
 */
export function cardVisibility(b: Bootstrap): CardVisibility {
  return {
    unlocking: unlockRows(b).length > 0,
    body: weighInsInWindow(b) >= MIN_WEIGH_INS_FOR_TREND,
    goals: true,
    bigLifts: hasStrengthPoint(b),
    setsPerMuscle: hasLifted(b),
    thisMonth: b.history.days.length > 0,
    runMiles: !loadBlock(b).empty,
  };
}

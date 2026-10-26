/*
 * Relative imports, same reason as `model.ts`: this module has to run under the
 * node-environment vitest config, so it stays free of `react-native` and of
 * build configuration.
 */
import type { Bootstrap } from "../../lib/types";
import { fmtWeight } from "../voice/model";
import { liftDaysIn, plural } from "./model";
import { LIFT_DAY_WINDOW, MIN_LIFT_DAYS, owed, setsShort } from "./verdict";
import type { Verdict } from "./verdict";

/**
 * The hero card at the top of Today: one sentence, one button, three marks.
 *
 * The sentence is `verdict.ts`'s and is not re-derived here. What this module
 * adds is everything around it that the old screen scattered — the owed
 * muscles as chips beside the call, the button the call implies, and three
 * "done today" marks (Apple Fitness rings, without the rings) that give a
 * day-one account something to tick off before there is any trend to read.
 *
 * Note what the marks are NOT: a diary. They are three booleans and one
 * figure each, chosen because each one feeds something the app measures —
 * weigh-ins feed maintenance, food feeds maintenance and protein, sets feed the
 * muscle ranking the sentence above them is built on.
 */

/** Owed chips, at most. Two fit one line at phone width beside nothing else. */
export const MAX_OWED_CHIPS = 2;

export type CheckKey = "weigh" | "food" | "train";

export interface DailyCheck {
  key: CheckKey;
  done: boolean;
  /** The label beside the ring: the figure when done, the verb when not. */
  text: string;
}

export interface HeroAction {
  label: string;
  variant: "primary" | "secondary";
}

/** Today's row in the 56-day history, or nothing — absent days are absent. */
const todayRow = (b: Bootstrap) => b.history.days.find((d) => d.date === b.today) ?? null;

/**
 * The three marks.
 *
 * `justLoggedLb` is a weigh-in typed on this phone a moment ago, shown until
 * the next `bootstrap` lands — the same rule You's weight figure follows, for
 * the same reason: a mark that does not fill after you log reads as a save that
 * did not happen.
 */
export function dailyChecks(b: Bootstrap, justLoggedLb: number | null = null): DailyCheck[] {
  const row = todayRow(b);

  const weighed = justLoggedLb ?? row?.weightLb ?? null;

  /*
   * Protein left rather than kcal, on purpose. Protein is the one target that
   * exists before calibration (1.8 g/kg from day one), so it is a real number
   * on the first morning; a kcal figure on Today would be either missing for
   * three weeks or a guess the owner anchors on.
   *
   * Rounded before the comparison, so "0 g protein left" can never render —
   * 0.4 g short is "protein hit", which is what anybody would call it.
   */
  const ate = b.mealCount > 0;
  const proteinLeft = Math.round(b.target.proteinG - b.totals.proteinG);

  const sets = row?.hardSets ?? 0;
  const inSession = b.activeWorkout !== null;

  return [
    {
      key: "weigh",
      done: weighed !== null,
      text: weighed !== null ? `${formatBodyweight(weighed)} lb` : "Weigh in",
    },
    {
      key: "food",
      done: ate,
      text: !ate ? "Log food" : proteinLeft > 0 ? `${proteinLeft} g protein left` : "protein hit",
    },
    {
      key: "train",
      done: sets > 0 || inSession,
      text: sets > 0 ? plural(sets, "set") : inSession ? "in session" : "Train",
    },
  ];
}

/**
 * Bodyweight to one decimal, and none when it is whole.
 *
 * Not `fmtWeight`, which is whole pounds for loads: a scale reading of 182.4
 * printed as 182 would disagree with the scale the owner is standing beside.
 */
function formatBodyweight(lb: number): string {
  const rounded = Math.round(lb * 10) / 10;
  return Number.isInteger(rounded) ? fmtWeight(rounded) : rounded.toFixed(1);
}

/**
 * Up to two "Back · 6 short" chips from the server's ranking.
 *
 * Hidden on rung 1. A day-one account has every muscle at a score of 1 with no
 * history, so the chips would be the first two muscles the server happened to
 * sort, presented as a finding — exactly what the verdict's own rung 1 refuses
 * to do. The sentence already says "start one"; chips beside it would argue.
 */
export function owedChips(b: Bootstrap): string[] {
  if (liftDaysIn(b.history.days, b.today, LIFT_DAY_WINDOW) < MIN_LIFT_DAYS) return [];

  return b.volume.ranked
    .filter(owed)
    .slice(0, MAX_OWED_CHIPS)
    .map((r) => `${r.label} · ${setsShort(r)} short`);
}

/**
 * The one button the sentence implies.
 *
 * Every destination is `/lift`, and that is deliberate: the app never assigns
 * a day, so the button does not start "a back workout". It opens the session,
 * where the same ranking the sentence came from orders what to do.
 *
 * The rest-day rungs keep a button rather than losing it — "take today off" is
 * advice, not a lock — but it is secondary and says ANYWAY, so it cannot read
 * as the instruction.
 */
export function heroAction(b: Bootstrap, call: Verdict): HeroAction {
  if (b.activeWorkout !== null) return { label: "RESUME SESSION", variant: "primary" };
  if (call.kind === "rest" || call.kind === "nothing_owed") {
    return { label: "LOG A LIFT ANYWAY", variant: "secondary" };
  }
  return { label: "START LIFT", variant: "primary" };
}

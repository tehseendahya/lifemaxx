/*
 * Why a day's food card has one target on it and three missing ones, said out
 * loud instead of drawn as an empty bar.
 *
 * §5.5 of SPEC.md: for the first three weeks there is deliberately no calorie
 * target. A calculator's guess at maintenance is wrong by 200-400 kcal and the
 * user anchors on it anyway, so the app measures maintenance from their own
 * weigh-ins first and only then proposes a number. Protein is the exception
 * that is targeted from day one, because ~1.8 g/kg is right whichever way the
 * goal eventually goes.
 *
 * All of that is correct behaviour. What was wrong was the rendering: protein
 * got a target and a filled bar, carbs and fat got a target of `null` and
 * therefore a 0%-wide fill in a grey track. A bar at zero does not say "no
 * target yet" — it says "you have eaten none of your carbs", which on a day
 * with 290 g of carbs logged reads as a broken screen. The owner read it as
 * exactly that, and they were right to.
 *
 * So this module answers three questions as data, and `FuelCard` only draws
 * them: which macros can be drawn against a target at all, what the figure
 * beside the kcal total should say, and what the user should be told is
 * happening instead.
 *
 * Imports are relative rather than `@/lib/...` so this runs under
 * `mobile/vitest.config.ts`, which is a plain node environment with no path
 * alias — the same convention `model.ts` and the Today, Runs and settings
 * models all follow. Nothing here imports `react-native`, which is what makes
 * it testable in a container with no simulator.
 */
import type { TdeeResult } from "../../lib/shared/tdee";
import type { MacroTotals, TargetDto } from "../../lib/types";

/**
 * One macro row on the fuel card.
 *
 * The two cases are not a nicety — they are the whole fix. `targeted` is a
 * `MacroBar`; `logged` is a figure with no track behind it at all, because
 * there is no scale to draw it against and inventing one is what produced the
 * dead grey bar.
 */
export type MacroReadout =
  | {
      kind: "targeted";
      label: string;
      value: number;
      target: number;
      /** Protein is the floor to clear, not the ceiling to stay under. */
      tone: "accent" | "good";
    }
  | { kind: "logged"; label: string; value: number };

/** Progress through the thing that is actually blocking a target. */
export interface CalibrationProgress {
  /** "6 of 8 weigh-ins" — the spec's own wording. */
  label: string;
  have: number;
  needed: number;
}

export interface CalibrationNote {
  /** The micro-label: "CALIBRATING" or "READY FOR A TARGET". */
  badge: string;
  /** Why there is no calorie target. Plain, and never apologetic. */
  body: string;
  /** Null when the count is not the thing standing in the way. */
  progress: CalibrationProgress | null;
  /** The one thing to do about it, or null when there is nothing to do. */
  action: string | null;
}

export interface FuelView {
  /** The 30pt figure, and the muted text that follows it on the same baseline. */
  kcal: { value: number; tail: string };
  macros: MacroReadout[];
  /** Null once a real target exists — then the card is the plain three bars. */
  calibration: CalibrationNote | null;
}

/**
 * The day's fuel card, as data.
 *
 * `tdee` is optional because the Food screen reads it out of the `bootstrap`
 * cache rather than fetching it: the weigh-in count is a nice-to-have on this
 * screen and not worth a second fat request for. Passing `null` degrades to a
 * card that still explains calibration, just without the count — which is the
 * behaviour on a cold launch straight into the Food tab.
 */
export function buildFuelView(
  totals: MacroTotals,
  target: TargetDto,
  tdee: TdeeResult | null,
): FuelView {
  /*
   * `target.kcal === null` is the test, not `target.mode === "calibrating"`.
   * `mode` is wording — it comes from the `targets` row's enum and the route
   * substitutes "calibrating" when there is no row at all — but what decides
   * whether a bar can be drawn is whether there is a number to divide by. Any
   * future mode that arrives without a kcal figure must still render as a
   * figure rather than as an empty track.
   */
  const calibrating = target.kcal === null;

  return {
    kcal: {
      value: Math.round(totals.kcal),
      tail: calibrating ? "kcal logged" : `of ${target.kcal} kcal`,
    },
    macros: [
      // Protein is `tone: "good"` in both modes: it is a floor to clear, and it
      // is the one figure that is correct during calibration and after it.
      { kind: "targeted", label: "Protein", value: totals.proteinG, target: target.proteinG, tone: "good" },
      macroReadout("Carbs", totals.carbsG, target.carbsG),
      macroReadout("Fat", totals.fatG, target.fatG),
    ],
    calibration: calibrating ? calibrationNote(tdee) : null,
  };
}

/**
 * Per-macro rather than per-card, deliberately.
 *
 * Today the `targets` row carries all four figures or there is no row, so
 * carbs and fat are null exactly when kcal is. Deciding it per macro costs one
 * line and means a half-filled row — a kcal target set by hand with the macro
 * split left blank — degrades to a figure instead of regrowing the dead bar
 * this module exists to remove.
 */
function macroReadout(label: string, value: number, target: number | null): MacroReadout {
  if (target === null || target <= 0) return { kind: "logged", label, value };
  return { kind: "targeted", label, value, target, tone: "accent" };
}

/**
 * What to say while there is no calorie target.
 *
 * Three states, and they are not interchangeable — the user's next action is
 * different in each. The copy says what the app is doing and what it needs,
 * and it never calls the missing target a limitation.
 */
function calibrationNote(tdee: TdeeResult | null): CalibrationNote {
  const why =
    "No calorie target yet, on purpose. Your maintenance is being measured from "
    + "your own weigh-ins rather than guessed from a calculator — about three weeks. "
    + "Protein is targeted from day one because it is right either way.";

  // No bootstrap payload cached: explain, but claim no count. Showing "0 of 8"
  // here would be a lie about the user's data rather than about ours.
  if (tdee === null) {
    return { badge: "Calibrating", body: why, progress: null, action: null };
  }

  if (tdee.status === "ok") {
    /*
     * Measured, but no target row — the end of calibration. The three options
     * live on the You tab (`features/settings` builds them from `proposeTargets`),
     * and there is no endpoint that writes a `targets` row from the phone, so
     * this points at the screen that can explain them rather than offering a
     * button that cannot save.
     */
    return {
      badge: "Ready for a target",
      body: `Maintenance measured at ${tdee.tdee} kcal, ±${tdee.marginKcal}, from `
        + `${plural(tdee.weighIns, "weigh-in")}. Pick cut, maintain or lean bulk and these `
        + "figures get targets.",
      progress: null,
      action: "Choose one on the You tab.",
    };
  }

  /*
   * `estimateTdee` has two floors, not one: at least `needed` weigh-ins AND at
   * least seven days with food logged. A user who weighs in every morning and
   * photographs nothing clears the first and fails the second, and would then
   * read "13 of 8 weigh-ins" above a bar `MacroBar` colours `warn` for being
   * over target — telling them to do more of the thing they have already done
   * enough of. So the count is only shown while it is the count that is short.
   */
  if (tdee.weighIns >= tdee.needed) {
    return {
      badge: "Calibrating",
      body: `${plural(tdee.weighIns, "weigh-in")} logged, which is enough. The gap is food: `
        + "maintenance needs about a week of logged days to compare the scale against.",
      progress: null,
      action: "Log most days and the target appears on its own.",
    };
  }

  return {
    badge: "Calibrating",
    body: why,
    progress: {
      label: `${tdee.weighIns} of ${tdee.needed} weigh-ins`,
      have: tdee.weighIns,
      needed: tdee.needed,
    },
    action: "Weigh in most mornings.",
  };
}

/** "1 weigh-in" / "13 weigh-ins". Matches `features/settings/model.ts`. */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

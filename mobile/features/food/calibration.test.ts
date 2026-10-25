import { describe, expect, it } from "vitest";

import { buildFuelView, type MacroReadout } from "./calibration";
import type { TdeeResult } from "../../lib/shared/tdee";
import type { MacroTotals, TargetDto } from "../../lib/types";

/** A real day: 2,195 kcal with the macro split that produced it. */
const totals: MacroTotals = { kcal: 2194.6, proteinG: 142.4, carbsG: 231, fatG: 74.2 };

/** What `GET /api/mobile/food` returns before day 21 — protein only. */
const calibrating: TargetDto = {
  kcal: null,
  proteinG: 165,
  carbsG: null,
  fatG: null,
  mode: "calibrating",
};

/** What it returns after a target has been set, measured against the seeded db. */
const settled: TargetDto = {
  kcal: 2600,
  proteinG: 165,
  carbsG: 300,
  fatG: 80,
  mode: "maintain",
};

const shortOfWeighIns: TdeeResult = { status: "insufficient_data", weighIns: 6, needed: 8 };

const measured: TdeeResult = {
  status: "ok",
  tdee: 2610,
  marginKcal: 110,
  trendKgPerWeek: -0.16,
  currentKg: 91.6,
  meanIntake: 2430,
  weighIns: 13,
};

const find = (macros: MacroReadout[], label: string): MacroReadout => {
  const row = macros.find((m) => m.label === label);
  if (row === undefined) throw new Error(`no ${label} row`);
  return row;
};

describe("with a real target", () => {
  const view = buildFuelView(totals, settled, measured);

  it("puts all three macros on a bar and says nothing about calibration", () => {
    expect(view.calibration).toBeNull();
    expect(view.macros.map((m) => m.kind)).toEqual(["targeted", "targeted", "targeted"]);
  });

  it("counts the kcal against the target", () => {
    expect(view.kcal).toEqual({ value: 2195, tail: "of 2600 kcal" });
  });

  it("keeps protein on the `good` tone and the rest on the accent", () => {
    // Protein is the floor to clear rather than the ceiling to stay under, and
    // that distinction survived the rewrite — it is the web app's treatment.
    expect(find(view.macros, "Protein")).toMatchObject({ tone: "good", target: 165 });
    expect(find(view.macros, "Carbs")).toMatchObject({ tone: "accent", target: 300 });
  });
});

describe("during calibration", () => {
  const view = buildFuelView(totals, calibrating, shortOfWeighIns);

  it("never draws a bar for a macro that has no target", () => {
    // The entire bug: carbs and fat used to render a 0%-wide fill in a grey
    // track, which on a 231 g day reads as "you have eaten no carbs".
    expect(find(view.macros, "Carbs")).toEqual({ kind: "logged", label: "Carbs", value: 231 });
    expect(find(view.macros, "Fat")).toEqual({ kind: "logged", label: "Fat", value: 74.2 });
  });

  it("still shows the one target that is real", () => {
    expect(find(view.macros, "Protein")).toMatchObject({ kind: "targeted", target: 165, tone: "good" });
  });

  it("shows the kcal that IS known, labelled as a measurement rather than a score", () => {
    expect(view.kcal).toEqual({ value: 2195, tail: "kcal logged" });
  });

  it("says what is happening and what to do about it", () => {
    expect(view.calibration?.badge).toBe("Calibrating");
    expect(view.calibration?.body).toContain("on purpose");
    expect(view.calibration?.action).toBe("Weigh in most mornings.");
  });

  it("reports weigh-in progress in the spec's own wording", () => {
    expect(view.calibration?.progress).toEqual({ label: "6 of 8 weigh-ins", have: 6, needed: 8 });
  });
});

describe("the edges of calibration", () => {
  it("explains itself with no bootstrap payload cached", () => {
    // Opening Food on a cold launch, before Today's fat request has landed.
    // The card must still say why there is one target, just without a count.
    const view = buildFuelView(totals, calibrating, null);
    expect(view.calibration?.body).toContain("maintenance");
    expect(view.calibration?.progress).toBeNull();
    expect(view.kcal.tail).toBe("kcal logged");
  });

  it("blames food logging, not the scale, when the weigh-ins are already enough", () => {
    /*
     * `estimateTdee` has two floors — >= 8 weigh-ins AND >= 7 days of intake.
     * Clearing the first and failing the second used to be invisible: the count
     * would have read "13 of 8" and `MacroBar` would have coloured the bar
     * `warn` for being over, telling the user to do more weighing.
     */
    const view = buildFuelView(totals, calibrating, {
      status: "insufficient_data", weighIns: 13, needed: 8,
    });
    expect(view.calibration?.progress).toBeNull();
    expect(view.calibration?.body).toContain("The gap is food");
    expect(view.calibration?.action).toContain("Log most days");
  });

  it("switches to the end-of-calibration prompt once maintenance is measurable", () => {
    const view = buildFuelView(totals, calibrating, measured);
    expect(view.calibration?.badge).toBe("Ready for a target");
    expect(view.calibration?.body).toContain("2610 kcal");
    expect(view.calibration?.body).toContain("±110");
    expect(view.calibration?.body).toContain("13 weigh-ins");
    // The phone has no endpoint that writes a `targets` row, so this points at
    // the screen that can explain the three options instead of promising a save.
    expect(view.calibration?.action).toBe("Choose one on the You tab.");
  });

  it("singularises one weigh-in", () => {
    const view = buildFuelView(totals, calibrating, { ...measured, weighIns: 1 });
    expect(view.calibration?.body).toContain("from 1 weigh-in.");
  });

  it("reads mode as wording and the kcal figure as the decision", () => {
    /*
     * A mode of "maintain" with no kcal must still render as figures. `mode`
     * is an enum on a row; what decides whether a bar can be drawn is whether
     * there is a number to divide by.
     */
    const view = buildFuelView(totals, { ...calibrating, mode: "maintain" }, measured);
    expect(view.calibration).not.toBeNull();
    expect(find(view.macros, "Carbs").kind).toBe("logged");
  });

  it("treats a zero target as no target", () => {
    // A 0 g carb target would divide into an infinite percentage; it is also
    // not a thing anyone means.
    const view = buildFuelView(totals, { ...settled, carbsG: 0 }, measured);
    expect(find(view.macros, "Carbs").kind).toBe("logged");
    // kcal is still set, so the card is not in calibration mode.
    expect(view.calibration).toBeNull();
  });

  it("rounds the kcal figure and leaves the gram figures alone", () => {
    // The card rounds grams at the point of display; rounding here too would
    // make the row disagree with the review card that wrote it.
    const view = buildFuelView(totals, calibrating, measured);
    expect(view.kcal.value).toBe(2195);
    expect(find(view.macros, "Fat")).toMatchObject({ value: 74.2 });
  });

  it("handles an empty day without inventing anything", () => {
    const view = buildFuelView({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }, calibrating, null);
    expect(view.kcal).toEqual({ value: 0, tail: "kcal logged" });
    expect(find(view.macros, "Protein")).toMatchObject({ kind: "targeted", value: 0 });
  });
});

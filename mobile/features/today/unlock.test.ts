import { describe, expect, it } from "vitest";

import { TODAY, bootstrap, day, emptyBootstrap, run, threeWeighIns } from "./fixture";
import { shiftIso } from "./model";
import {
  TDEE_WINDOW_DAYS, calibrationView, cardVisibility, daysToCalibrate, unlockCard, unlockRows,
} from "./unlock";
import type { Bootstrap } from "../../lib/types";

/**
 * The cold-start contract of the Today screen.
 *
 * The owner's complaint was "odd empty graphs" before the eight days of data
 * had come in. These tests are the acceptance criteria for the fix, stated as
 * data: which cards may render at each stage, and what the Unlocking card says
 * instead of the ones that may not.
 */

/** A calibrated account: TDEE measured, lifts on record, weigh-ins plenty. */
const calibrated = (): Bootstrap => bootstrap({
  history: {
    days: [
      day("2026-10-20", { weightLb: 182, kcal: 2300, hardSets: 18 }),
      day("2026-10-22", { weightLb: 181, kcal: 2200, hardSets: 16 }),
      day("2026-10-24", { weightLb: 181, kcal: 2250 }),
    ],
    mainLifts: [{
      exerciseId: "ex-bench",
      name: "Barbell Bench Press",
      points: [{ date: "2026-10-20", e1rmLb: 216 }],
    }],
  },
});

describe("day one: an empty bootstrap", () => {
  it("renders no chart card at all — only Unlocking and Goals", () => {
    const v = cardVisibility(emptyBootstrap());
    expect(v).toEqual({
      unlocking: true,
      body: false,
      goals: true,
      bigLifts: false,
      setsPerMuscle: false,
      thisMonth: false,
      runMiles: false,
    });
  });

  it("lists all four locked things with their counts", () => {
    const rows = unlockRows(emptyBootstrap());
    expect(rows.map((r) => [r.title, r.progress])).toEqual([
      ["Weight trend", "0 of 2 weigh-ins"],
      ["Maintenance calories", "0 of 8 weigh-ins · 0 of 7 food days"],
      ["Strength trend", "Log a bench, squat, deadlift or overhead press"],
      ["Sets per muscle", "Log one session"],
    ]);
  });

  it("says none of the four are ready, and how long maintenance takes", () => {
    const card = unlockCard(emptyBootstrap())!;
    expect(card.readyLabel).toBe("0 OF 4 READY");
    expect(card.footer).toBe(
      "About 8 more days of weighing in and logging food until your real maintenance number. "
      + "Then calorie targets switch on.",
    );
  });

  it("sends every locked row to the tap that fills it", () => {
    expect(unlockRows(emptyBootstrap()).map((r) => r.action))
      .toEqual(["weigh", "weigh", "lift", "lift"]);
  });
});

describe("three weigh-ins and two food days", () => {
  it("shows the Body card and nothing else that charts", () => {
    const v = cardVisibility(threeWeighIns());
    expect(v.body).toBe(true);
    expect(v.bigLifts).toBe(false);
    expect(v.setsPerMuscle).toBe(false);
    expect(v.runMiles).toBe(false);
    // Any history at all brings This month in, with its zeroes.
    expect(v.thisMonth).toBe(true);
  });

  it("keeps the Maintenance row at 3 of 8, with the food count", () => {
    const rows = unlockRows(threeWeighIns());
    expect(rows.map((r) => r.key)).toEqual(["maintenance", "strength", "volume"]);
    expect(rows[0].progress).toBe("3 of 8 weigh-ins · 2 of 7 food days");
    expect(rows[0].tracks).toEqual([{ have: 3, need: 8 }, { have: 2, need: 7 }]);
    expect(unlockCard(threeWeighIns())!.readyLabel).toBe("1 OF 4 READY");
  });

  it("counts the larger shortfall as the days left", () => {
    // 8 − 3 = 5 weigh-ins short, 7 − 2 = 5 food days short.
    expect(unlockCard(threeWeighIns())!.footer).toBe(
      "About 5 more days of weighing in and logging food until your real maintenance number. "
      + "Then calorie targets switch on.",
    );
  });

  it("drops the Weight trend row at exactly two weigh-ins, and not at one", () => {
    const one = emptyBootstrap({ history: { days: [day(TODAY, { weightLb: 182 })], mainLifts: [] } });
    expect(unlockRows(one)[0]).toMatchObject({ key: "weight", progress: "1 of 2 weigh-ins" });
    expect(cardVisibility(one).body).toBe(false);

    const two = emptyBootstrap({
      history: {
        days: [day(shiftIso(TODAY, -1), { weightLb: 183 }), day(TODAY, { weightLb: 182 })],
        mainLifts: [],
      },
    });
    expect(unlockRows(two).map((r) => r.key)).not.toContain("weight");
    expect(cardVisibility(two).body).toBe(true);
  });

  it("ignores weigh-ins older than the Body chart's 28 days", () => {
    const stale = emptyBootstrap({
      history: {
        days: [day("2026-09-01", { weightLb: 185 }), day("2026-09-02", { weightLb: 184 })],
        mainLifts: [],
      },
    });
    expect(cardVisibility(stale).body).toBe(false);
  });
});

describe("calibrated", () => {
  it("has no Unlocking card at all", () => {
    expect(unlockRows(calibrated())).toEqual([]);
    expect(unlockCard(calibrated())).toBeNull();
    expect(cardVisibility(calibrated()).unlocking).toBe(false);
  });

  it("has no calibration view once maintenance is measured", () => {
    expect(calibrationView(calibrated())).toBeNull();
  });
});

describe("the other thresholds", () => {
  it("unlocks Strength on a single e1RM point — the card then says it is one", () => {
    const b = emptyBootstrap({
      history: {
        days: [],
        mainLifts: [{ exerciseId: "ex-bench", name: "Barbell Bench Press", points: [{ date: TODAY, e1rmLb: 200 }] }],
      },
    });
    expect(cardVisibility(b).bigLifts).toBe(true);
    expect(unlockRows(b).map((r) => r.key)).not.toContain("strength");
  });

  it("does not count a lift series with no points", () => {
    const b = emptyBootstrap({
      history: { days: [], mainLifts: [{ exerciseId: "ex-bench", name: "Bench", points: [] }] },
    });
    expect(cardVisibility(b).bigLifts).toBe(false);
  });

  it("unlocks Sets per muscle on one working set anywhere in 56 days", () => {
    const warmupsOnly = emptyBootstrap({ history: { days: [day("2026-10-01")], mainLifts: [] } });
    expect(cardVisibility(warmupsOnly).setsPerMuscle).toBe(false);

    const lifted = emptyBootstrap({
      history: { days: [day("2026-09-01", { hardSets: 4 })], mainLifts: [] },
    });
    expect(cardVisibility(lifted).setsPerMuscle).toBe(true);
    expect(unlockRows(lifted).map((r) => r.key)).not.toContain("volume");
  });

  it("shows Run miles only with a run in eight weeks", () => {
    expect(cardVisibility(emptyBootstrap({ runs: [run()] })).runMiles).toBe(true);
    expect(cardVisibility(emptyBootstrap({ runs: [] })).runMiles).toBe(false);
  });

  it("never shows a card and its Unlocking row at once, and never neither", () => {
    const states = [emptyBootstrap(), threeWeighIns(), calibrated()];
    for (const b of states) {
      const v = cardVisibility(b);
      const locked = new Set(unlockRows(b).map((r) => r.key));
      expect(v.body).toBe(!locked.has("weight"));
      expect(v.bigLifts).toBe(!locked.has("strength"));
      expect(v.setsPerMuscle).toBe(!locked.has("volume"));
    }
  });
});

describe("daysToCalibrate", () => {
  it("is the larger of the two shortfalls", () => {
    expect(daysToCalibrate(0, 0)).toBe(8);
    expect(daysToCalibrate(6, 2)).toBe(5);
    expect(daysToCalibrate(7, 7)).toBe(1);
  });

  it("never goes below zero", () => {
    expect(daysToCalibrate(12, 20)).toBe(0);
  });
});

describe("calibration copy", () => {
  it("says one more day, not one more days", () => {
    const b = emptyBootstrap({
      tdee: { status: "insufficient_data", weighIns: 7, needed: 8 },
      history: {
        days: Array.from({ length: 7 }, (_, i) => day(shiftIso(TODAY, -i), { kcal: 2200 })),
        mainLifts: [],
      },
    });
    expect(calibrationView(b)!.footer).toBe(
      "About 1 more day of weighing in and logging food until your real maintenance number. "
      + "Then calorie targets switch on.",
    );
  });

  it("admits the counts are in when the fit still needs spread", () => {
    const b = emptyBootstrap({
      tdee: { status: "insufficient_data", weighIns: 9, needed: 8 },
      history: {
        days: Array.from({ length: 8 }, (_, i) => day(shiftIso(TODAY, -i), { kcal: 2200 })),
        mainLifts: [],
      },
    });
    const cal = calibrationView(b)!;
    expect(cal.footer)
      .toBe("Counts are in. Needs a few more days spread across the window to fit a trend.");
    // Clamped: never "9 of 8".
    expect(cal.progress).toBe("8 of 8 weigh-ins · 7 of 7 food days");
    expect(cal.action).toBe("food");
  });

  it("counts food days over the server's 29-day TDEE window, not the chart's 28", () => {
    expect(TDEE_WINDOW_DAYS).toBe(29);
    const edge = emptyBootstrap({
      history: { days: [day(shiftIso(TODAY, -28), { kcal: 2000 })], mainLifts: [] },
    });
    expect(calibrationView(edge)!.foodDays.have).toBe(1);
  });

  it("points at the pad while weigh-ins are short, then at food", () => {
    expect(calibrationView(threeWeighIns())!.action).toBe("weigh");
  });
});

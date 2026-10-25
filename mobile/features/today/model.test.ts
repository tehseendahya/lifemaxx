import { describe, expect, it } from "vitest";

import { CATALOGUE, TODAY, bootstrap, day, liftHistory, ranked, run } from "./fixture";
import {
  buildTodayModel, consistencyBlock, currentWeightLb, formatDuration, formatLongDate,
  formatShortDate, gapFor, goalsBlock, intakeDaysIn, liftDaysIn, loadBlock, median,
  rollingMean, signed, strengthRows, trajectory, weighInStreak, withinDays,
} from "./model";
import type { GoalClaim } from "./goals";
import type { HistoryDay } from "../../lib/types";

/**
 * There is no simulator in this container, so every figure the Today screen
 * prints is asserted here or it has never been seen by anybody.
 *
 * The cases that matter most are the degenerate ones, which is why there are so
 * many of them: the first-week account with an entirely empty payload, the
 * account with one weigh-in, the account below the TDEE floor. Those are what
 * the owner saw on day one, and a dashboard that divides by zero on them is
 * worse than the repetitive one it replaced.
 */

const weights = (entries: [string, number][]): HistoryDay[] =>
  entries.map(([date, weightLb]) => day(date, { weightLb }));

/** The first-week account: every array empty, no target, no maintenance. */
const firstWeek = () => bootstrap({
  goalsText: "",
  tdee: { status: "insufficient_data", weighIns: 0, needed: 8 },
  runs: [],
  history: { days: [], mainLifts: [] },
  volume: { summary: "Everything's in range this week.", ranked: [] },
});

describe("dates", () => {
  it("reads the server's date, not the device clock", () => {
    expect(formatLongDate(TODAY)).toBe("Sunday, October 25");
    expect(formatLongDate("2026-01-01")).toBe("Thursday, January 1");
  });

  it("formats a chart's end label", () => {
    expect(formatShortDate("2026-08-31")).toBe("31 Aug");
    expect(formatShortDate("2026-10-01")).toBe("1 Oct");
  });

  it("drops seconds above the hour, because that is how a race target is written", () => {
    expect(formatDuration(6600)).toBe("1:50");
    expect(formatDuration(1290)).toBe("21:30");
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(-10)).toBe("0:00");
  });

  it("always signs a figure whose sign is its whole content", () => {
    expect(signed(-0.36, 1)).toBe("−0.4");
    expect(signed(0.36, 1)).toBe("+0.4");
    expect(signed(0, 1)).toBe("0.0");
  });

  it("takes the median of an even-length series", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([5])).toBe(5);
    expect(median([])).toBe(0);
  });
});

describe("windows", () => {
  const days = [
    day("2026-09-01", { hardSets: 10 }),
    day("2026-09-28", { hardSets: 10, kcal: 2000 }),
    day("2026-10-20", { hardSets: 12, kcal: 2200 }),
    day("2026-10-25", { kcal: 0 }),
  ];

  it("includes today and excludes the day before the window opens", () => {
    // 28 days back from 25 Oct is 28 Sep inclusive.
    expect(withinDays(days, TODAY, 28).map((d) => d.date))
      .toEqual(["2026-09-28", "2026-10-20", "2026-10-25"]);
  });

  it("counts lift days and intake days inside the window only", () => {
    expect(liftDaysIn(days, TODAY, 28)).toBe(2);
    // The zero-kcal day does not count as intake data.
    expect(intakeDaysIn(days, TODAY, 28)).toBe(2);
  });
});

describe("rollingMean", () => {
  const three = [
    day("2026-10-20", { kcal: 2000 }),
    day("2026-10-21", { kcal: 2200 }),
    day("2026-10-22", { kcal: 2400 }),
  ];

  it("stays undefined until three real days are in the window", () => {
    expect(rollingMean(three, 7)).toEqual([
      { date: "2026-10-20", mean: null },
      { date: "2026-10-21", mean: null },
      { date: "2026-10-22", mean: 2200 },
    ]);
  });

  it("materialises the gaps, so a week of not logging is visible as a week", () => {
    const sparse = [day("2026-10-20", { kcal: 2000 }), day("2026-10-25", { kcal: 2500 })];
    const series = rollingMean(sparse, 7);
    expect(series).toHaveLength(6);
    expect(series.every((p) => p.mean === null)).toBe(true);
  });

  it("excludes unlogged days from the mean rather than counting them as zero", () => {
    const withGap = [
      day("2026-10-20", { kcal: 3000 }),
      day("2026-10-21"),
      day("2026-10-22", { kcal: 3000 }),
      day("2026-10-23", { kcal: 3000 }),
    ];
    // 3000, not 9000/4 = 2250. A skipped log is not a fast.
    expect(rollingMean(withGap, 7).at(-1)).toEqual({ date: "2026-10-23", mean: 3000 });
  });

  it("is empty for no days at all", () => {
    expect(rollingMean([], 7)).toEqual([]);
  });
});

describe("weighInStreak", () => {
  it("counts consecutive days back from the most recent weigh-in", () => {
    const days = weights([["2026-10-23", 181], ["2026-10-24", 180], ["2026-10-25", 180]]);
    expect(weighInStreak(days)).toEqual({ count: 3, through: TODAY });
  });

  it("breaks on a single missed day — there is no forgiveness window", () => {
    const days = weights([["2026-10-21", 182], ["2026-10-23", 181], ["2026-10-24", 180]]);
    expect(weighInStreak(days)).toEqual({ count: 2, through: "2026-10-24" });
  });

  it("does not reduce the count because today is not over", () => {
    const days = weights([["2026-10-23", 181], ["2026-10-24", 180]]);
    expect(weighInStreak(days).count).toBe(2);
  });

  it("is zero with no weigh-ins ever", () => {
    expect(weighInStreak(liftHistory())).toEqual({ count: 0, through: null });
  });
});

describe("trajectory", () => {
  const fourWeighIns = weights([
    ["2026-10-04", 184], ["2026-10-11", 183], ["2026-10-18", 182], ["2026-10-25", 181],
  ]);

  it("plots the weigh-ins on a calendar axis and fits a line across their own range", () => {
    const t = trajectory(bootstrap({ history: { days: fourWeighIns, mainLifts: [] } }));

    expect(t.weight).not.toBeNull();
    const w = t.weight!;
    // Day numbers, not indices: the gaps between weigh-ins are the information.
    expect(w.xs).toEqual([20730, 20737, 20744, 20751]);
    expect(w.values).toEqual([184, 183, 182, 181]);
    expect(w.domainX).toEqual([20730, 20751]);
    // A perfectly linear −1 lb/wk series: the fit runs 184 → 181.
    expect(w.fit!.xs).toEqual([20730, 20751]);
    expect(w.fit!.values[0]).toBeCloseTo(184, 6);
    expect(w.fit!.values[1]).toBeCloseTo(181, 6);
    // ±1 lb, so a 3 lb move over a month is not drawn as a cliff.
    expect(w.domainY).toEqual([180, 185]);
    expect(w.firstLabel).toBe("184");
    expect(w.lastLabel).toBe("181");
  });

  it("asks for a second weigh-in rather than drawing a one-point trend", () => {
    const t = trajectory(bootstrap({
      history: { days: weights([["2026-10-25", 181]]), mainLifts: [] },
    }));
    expect(t.weight).toBeNull();
    expect(t.weightNote).toBe("Two weigh-ins and this draws itself. You have 1.");
  });

  it("says zero when there are none", () => {
    expect(trajectory(firstWeek()).weightNote).toBe(
      "Two weigh-ins and this draws itself. You have 0.",
    );
  });

  it("prints maintenance with its margin and weigh-in count", () => {
    const t = trajectory(bootstrap());
    expect(t.maintenance).toEqual({
      kind: "ok",
      value: "2377",
      hint: "±11 · 13 weigh-ins",
    });
    expect(t.trendLabel).toBe("−0.4 lb/wk");
  });

  it("replaces maintenance with a count while calibrating, and still draws a trend", () => {
    const t = trajectory(bootstrap({
      tdee: { status: "insufficient_data", weighIns: 4, needed: 8 },
      history: { days: fourWeighIns, mainLifts: [] },
    }));
    expect(t.maintenance).toEqual({
      kind: "calibrating",
      note: "4 of 8 weigh-ins. Keep going and maintenance appears here.",
    });
    // The on-device fit over the same window, since there is no server figure.
    expect(t.trendLabel).toBe("−1.0 lb/wk");
  });

  it("has no trend figure at all with fewer than two weigh-ins", () => {
    expect(trajectory(firstWeek()).trendLabel).toBeNull();
  });

  it("omits the intake panel below three logged days rather than drawing an empty box", () => {
    const days = [
      day("2026-10-23", { kcal: 2000 }),
      day("2026-10-24", { kcal: 2200 }),
    ];
    expect(trajectory(bootstrap({ history: { days, mainLifts: [] } })).intake).toBeNull();
    expect(trajectory(firstWeek()).intake).toBeNull();
  });

  it("draws the intake panel against maintenance", () => {
    const days = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]
      .map((d, i) => day(d, { kcal: 2000 + i * 100 }));
    const t = trajectory(bootstrap({ history: { days, mainLifts: [] } }));

    expect(t.intake).not.toBeNull();
    const panel = t.intake!;
    // Only the days where a 3-day-minimum trailing mean exists.
    expect(panel.values).toEqual([2100, 2150]);
    expect(panel.xs).toEqual([20748, 20749]);
    expect(panel.reference).toBe(2377);
    expect(panel.referenceLabel).toBe("MAINT 2377");
    // The reference is inside the domain, so the dashed line cannot fall off.
    expect(panel.domainY).toEqual([1950, 2527]);
  });

  it("drops the reference line while maintenance is uncomputable", () => {
    const days = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]
      .map((d, i) => day(d, { kcal: 2000 + i * 100 }));
    const t = trajectory(bootstrap({
      tdee: { status: "insufficient_data", weighIns: 2, needed: 8 },
      history: { days, mainLifts: [] },
    }));
    expect(t.intake!.reference).toBeNull();
    expect(t.intake!.referenceLabel).toBeNull();
  });

  it("starts the x axis at the first day with data, not at the nominal window start", () => {
    const t = trajectory(bootstrap({
      history: { days: weights([["2026-10-20", 182], ["2026-10-25", 181]]), mainLifts: [] },
    }));
    expect(t.xLabels).toEqual({ left: "20 Oct", right: "TODAY" });
  });
});

describe("goals", () => {
  it("is an invitation when nothing is written down", () => {
    const block = goalsBlock(firstWeek());
    expect(block.rows).toEqual([]);
    expect(block.empty).toBe(
      "Nothing written down yet. What you're actually training for goes on the You screen.",
    );
  });

  it("shows unreadable prose verbatim and says what would make it measurable", () => {
    const block = goalsBlock(bootstrap({ goalsText: "Feel strong. Sleep more." }));
    expect(block.rows).toEqual([]);
    expect(block.rest).toEqual(["Feel strong", "Sleep more"]);
    expect(block.note).toContain("No measurable target in this yet");
  });

  it("pairs each claim with its gap and its deadline", () => {
    const block = goalsBlock(bootstrap({
      goalsText: "Bench press 225 by March. Get to 175 lb.",
      catalogue: CATALOGUE,
      lastSets: {
        "ex-bench": {
          localDate: "2026-10-20", weightLb: 185, reps: 5, rpe: 8, sets: 3, bestE1rmLb: 215.8,
        },
      },
    }));

    expect(block.rows).toHaveLength(2);
    expect(block.rows[0].sentence).toBe("Bench press 225 by March");
    expect(block.rows[0].gap).toEqual({ text: "e1RM 216 → 225 · +9 lb", tone: "ink" });
    // 2027-03-01 is 127 days out: 18 whole weeks.
    expect(block.rows[0].deadline).toEqual({ label: "18w", tone: "muted" });
    expect(block.rows[1].gap.text).toContain("181 → 175");
    expect(block.rows[1].deadline).toBeNull();
  });

  it("warns on a tight deadline that is not met", () => {
    const block = goalsBlock(bootstrap({
      goalsText: "Get to 175 lb by November.",
      catalogue: CATALOGUE,
    }));
    // 1 November is seven days out: one whole week, and inside the warn band.
    expect(block.rows[0].deadline).toEqual({ label: "1w", tone: "warn" });
  });

  it("does not warn on a tight deadline that is already met", () => {
    const block = goalsBlock(bootstrap({
      goalsText: "Get to 181 lb by November.",
      catalogue: CATALOGUE,
    }));
    expect(block.rows[0].gap.tone).toBe("good");
    expect(block.rows[0].deadline!.tone).toBe("muted");
  });
});

describe("gapFor", () => {
  const bodyweight = (targetLb: number): GoalClaim =>
    ({ kind: "bodyweight", sentence: "", targetLb, byDate: null });

  it("measures bodyweight from the regression, not the last raw reading", () => {
    // tdee.currentKg is 82.085 kg = 180.96 lb. The raw history says 170.
    const b = bootstrap({ history: { days: weights([["2026-10-25", 170]]), mainLifts: [] } });
    expect(gapFor(bodyweight(175), b).text).toBe("181 → 175 · −6 lb to go · 17 wk at this rate");
  });

  it("falls back to the last raw weigh-in below the TDEE floor", () => {
    const b = bootstrap({
      tdee: { status: "insufficient_data", weighIns: 2, needed: 8 },
      history: { days: weights([["2026-10-20", 186], ["2026-10-25", 184]]), mainLifts: [] },
    });
    expect(currentWeightLb(b)).toBe(184);
    // No projection: there is no measured trend to project with.
    expect(gapFor(bodyweight(175), b).text).toBe("184 → 175 · −9 lb to go");
  });

  it("omits the projection when the trend points away from the target", () => {
    // Losing 0.36 lb/wk with a target above current weight.
    expect(gapFor(bodyweight(195), bootstrap()).text).toBe("181 → 195 · +14 lb to go");
  });

  it("calls a bodyweight goal met within a pound", () => {
    expect(gapFor(bodyweight(181), bootstrap()).tone).toBe("good");
  });

  it("says 'not enough data' rather than a zero when nothing has been weighed", () => {
    expect(gapFor(bodyweight(175), firstWeek())).toEqual({
      text: "not enough data",
      tone: "muted",
    });
  });

  const lift = (targetLb: number): GoalClaim => ({
    kind: "lift", sentence: "", exerciseId: "ex-bench", exerciseName: "Barbell Bench Press",
    targetLb, byDate: null,
  });

  it("takes the best e1RM across the series and the last session", () => {
    const b = bootstrap({
      history: {
        days: liftHistory(),
        mainLifts: [{
          exerciseId: "ex-bench",
          name: "Barbell Bench Press",
          points: [{ date: "2026-09-01", e1rmLb: 205 }, { date: "2026-10-20", e1rmLb: 218 }],
        }],
      },
      lastSets: {
        "ex-bench": {
          localDate: "2026-10-20", weightLb: 185, reps: 5, rpe: 8, sets: 3, bestE1rmLb: 230,
        },
      },
    });
    expect(gapFor(lift(225), b)).toEqual({ text: "e1RM 230 → 225 · −5 lb", tone: "good" });
  });

  it("says 'never logged' for a lift with no history, not 'not enough data'", () => {
    expect(gapFor(lift(225), bootstrap())).toEqual({ text: "never logged", tone: "muted" });
  });

  const distance = (mi: number): GoalClaim =>
    ({ kind: "run_distance", sentence: "", distanceMi: mi, byDate: null });

  it("measures a distance goal against the longest run on record", () => {
    const b = bootstrap({ runs: [run(), run({ id: "r2", distanceM: 16_093 })] });
    expect(gapFor(distance(13.1), b)).toEqual({ text: "longest 10.0 → 13.1 mi", tone: "ink" });
    expect(gapFor(distance(9), b).tone).toBe("good");
  });

  it("has nothing to say about a distance goal with no runs", () => {
    expect(gapFor(distance(13.1), firstWeek()).text).toBe("not enough data");
  });

  const time = (mi: number, sec: number): GoalClaim =>
    ({ kind: "run_time", sentence: "", distanceMi: mi, targetSec: sec, byDate: null });

  it("projects a time goal from measured pace and labels it as a projection", () => {
    // 8:42/mi over 13.1 mi is 1:54.
    const b = bootstrap({ runs: [run()] });
    expect(gapFor(time(13.1, 6600), b)).toEqual({
      text: "at your pace: 1:54 → 1:50 target",
      tone: "ink",
    });
    expect(gapFor(time(13.1, 7200), b).tone).toBe("good");
  });

  it("has nothing to say with no runs long enough to set a pace", () => {
    const b = bootstrap({ runs: [run({ distanceM: 1600, durationS: 600 })] });
    expect(gapFor(time(13.1, 6600), b).text).toBe("not enough data");
  });
});

describe("strength", () => {
  const lifts = (points: { date: string; e1rmLb: number }[]) => ({
    days: liftHistory(),
    mainLifts: [{ exerciseId: "ex-bench", name: "Barbell Bench Press", points }],
  });

  it("reports the delta over the window with its tone", () => {
    const [row] = strengthRows(bootstrap({
      history: lifts([
        { date: "2026-09-01", e1rmLb: 205.4 },
        { date: "2026-10-01", e1rmLb: 212 },
        { date: "2026-10-20", e1rmLb: 220.6 },
      ]),
    }));
    expect(row.values).toEqual([205, 212, 221]);
    expect(row.deltaLabel).toBe("+16 lb");
    expect(row.tone).toBe("good");
    expect(row.single).toBe(false);
  });

  it("warns on a negative delta and mutes a flat one", () => {
    const down = strengthRows(bootstrap({
      history: lifts([{ date: "2026-09-01", e1rmLb: 220 }, { date: "2026-10-01", e1rmLb: 210 }]),
    }))[0];
    expect(down).toMatchObject({ deltaLabel: "−10 lb", tone: "warn" });

    const flat = strengthRows(bootstrap({
      history: lifts([{ date: "2026-09-01", e1rmLb: 220 }, { date: "2026-10-01", e1rmLb: 220 }]),
    }))[0];
    expect(flat).toMatchObject({ deltaLabel: "0 lb", tone: "muted" });
  });

  it("refuses to fabricate a delta from one session", () => {
    const [row] = strengthRows(bootstrap({
      history: lifts([{ date: "2026-10-01", e1rmLb: 205 }]),
    }));
    expect(row.single).toBe(true);
    expect(row.deltaLabel).toBeNull();
  });

  it("is empty when nothing has two logged sessions", () => {
    expect(strengthRows(firstWeek())).toEqual([]);
  });
});

describe("load", () => {
  it("buckets working sets into eight Monday-start weeks, oldest first", () => {
    const days = [
      day("2026-08-31", { hardSets: 10 }), // the first bucket's Monday
      day("2026-09-06", { hardSets: 5 }), // the Sunday of the same week
      day("2026-10-19", { hardSets: 7 }), // the current, partial week
      day("2026-10-21", { hardSets: 9 }),
      day("2026-08-24", { hardSets: 99 }), // older than the window
    ];
    const load = loadBlock(bootstrap({ history: { days, mainLifts: [] } }));

    expect(load.weekStarts[0]).toBe("2026-08-31");
    expect(load.weekStarts[7]).toBe("2026-10-19");
    expect(load.hardSets).toEqual([15, 0, 0, 0, 0, 0, 0, 16]);
    expect(load.medianLabel).toBeNull();
    expect(load.partialIndex).toBe(7);
    expect(load.xLabels).toEqual({ left: "31 Aug", right: "THIS WK" });
    expect(load.empty).toBe(false);
  });

  it("takes the median across all eight buckets, zeroes included", () => {
    const load = loadBlock(bootstrap({
      history: {
        days: [day("2026-10-19", { hardSets: 20 }), day("2026-10-12", { hardSets: 10 })],
        mainLifts: [],
      },
    }));
    expect(load.median).toBe(0);
    // No reference label: a dashed line on the baseline is not information.
    expect(load.medianLabel).toBeNull();
  });

  it("puts run mileage in its own series over the same buckets", () => {
    const load = loadBlock(bootstrap({
      runs: [run({ localDate: "2026-10-20" }), run({ id: "r2", localDate: "2026-09-02" })],
    }));
    expect(load.runMiles[7]).toBe(5);
    expect(load.runMiles[0]).toBe(5);
    expect(load.runMiles[1]).toBe(0);
  });

  it("reports empty only when both series are flat for eight weeks", () => {
    expect(loadBlock(firstWeek()).empty).toBe(true);
    expect(loadBlock(bootstrap({
      history: { days: [], mainLifts: [] },
      runs: [run({ localDate: "2026-10-20" })],
    })).empty).toBe(false);
  });
});

describe("consistency", () => {
  it("prints the three figures that each unlock something", () => {
    const days = [
      ...weights([["2026-10-23", 182], ["2026-10-24", 181], ["2026-10-25", 181]]),
      day("2026-10-20", { kcal: 2200, hardSets: 18 }),
      day("2026-10-22", { kcal: 2100, hardSets: 16 }),
      day("2026-10-21", { kcal: 2300 }),
    ];
    const block = consistencyBlock(bootstrap({ history: { days, mainLifts: [] } }));

    expect(block.stats[0]).toEqual({ label: "WEIGH-INS", value: "3 day streak", hint: undefined });
    expect(block.stats[1]).toEqual({ label: "INTAKE", value: "3/28 days", hint: "TDEE NEEDS 7" });
    expect(block.stats[2]).toEqual({ label: "LIFTS", value: "2 in 28d", hint: "0.5/wk" });
    expect(block.note).toBe(
      "Streak counts days you weighed in. Nothing else — not app opens, not hitting a target.",
    );
  });

  it("says where a streak stops when the last weigh-in was not today", () => {
    const yesterday = consistencyBlock(bootstrap({
      history: { days: weights([["2026-10-24", 181]]), mainLifts: [] },
    }));
    expect(yesterday.stats[0].hint).toBe("THROUGH YESTERDAY");

    const older = consistencyBlock(bootstrap({
      history: { days: weights([["2026-10-20", 181]]), mainLifts: [] },
    }));
    expect(older.stats[0].hint).toBe("THROUGH 20 OCT");
  });

  it("renders zeroes rather than hiding, because a true zero is information", () => {
    const block = consistencyBlock(firstWeek());
    expect(block.stats.map((s) => s.value)).toEqual(["0 day streak", "0/28 days", "0 in 28d"]);
    expect(block.stats[0].hint).toBeUndefined();
  });
});

describe("the whole model", () => {
  it("builds every block from the first-week payload without throwing", () => {
    const m = buildTodayModel(firstWeek());
    expect(m.dateLine).toBe("Sunday, October 25");
    expect(m.sessionInProgress).toBe(false);
    expect(m.trajectory.weight).toBeNull();
    expect(m.trajectory.intake).toBeNull();
    expect(m.goals.empty).not.toBeNull();
    expect(m.strength).toEqual([]);
    expect(m.load.empty).toBe(true);
    expect(m.consistency.stats).toHaveLength(3);
  });

  it("never prints today's intake, today's protein or a per-muscle set row", () => {
    /*
     * The regression test for the owner's actual complaint: Today repeated what
     * the Food and Lift tabs already said. `totals` and `volume.ranked` are
     * both still in the payload and still used elsewhere, so the only thing
     * stopping this card from restating them is that nothing reads them.
     */
    const b = bootstrap({
      goalsText: "Bench press 225 by March.",
      catalogue: CATALOGUE,
      totals: { kcal: 1375, proteinG: 79, carbsG: 115, fatG: 68 },
      volume: { summary: "Rear Delts are owed sets.", ranked: [ranked()] },
    });
    const printed = JSON.stringify(buildTodayModel(b));

    expect(printed).not.toContain("1375");
    expect(printed).not.toContain("79");
    expect(printed).not.toContain("/10 sets");
    expect(printed).not.toContain("Rear Delts are owed sets");
  });

  it("notices a session in progress", () => {
    const m = buildTodayModel(bootstrap({
      activeWorkout: { id: "w1", startedAt: "2026-10-25T16:00:00.000Z" },
    }));
    expect(m.sessionInProgress).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import {
  isRun, miles, paceSecPerMile, formatPace, classifyRun, averagePaceSecPerMile,
  weekStartOf, weeklyRunStats, paceTrend, detectInterference, summarizeRunningWeek,
  M_PER_MILE, MIN_RUNS_FOR_TREND, type Run,
} from "./running";

const run = (over: Partial<Run> & { localDate: string }): Run => ({
  name: "Morning Run",
  type: "Run",
  distanceM: 5 * M_PER_MILE,
  durationS: 5 * 8 * 60, // 8:00/mi
  elevationM: 0,
  avgHr: 150,
  sufferScore: null,
  ...over,
});

describe("run identification", () => {
  it("counts runs and not rides", () => {
    expect(isRun("Run")).toBe(true);
    expect(isRun("TrailRun")).toBe(true);
    expect(isRun("Ride")).toBe(false);
    expect(isRun("Swim")).toBe(false);
  });
});

describe("pace", () => {
  it("computes seconds per mile", () => {
    expect(paceSecPerMile(M_PER_MILE, 480)).toBeCloseTo(480, 6);
  });

  it("has no opinion when there is no distance", () => {
    expect(paceSecPerMile(null, 1800)).toBeNull();
    expect(paceSecPerMile(0, 1800)).toBeNull();
  });

  it("formats as minutes and seconds", () => {
    expect(formatPace(522)).toBe("8:42");
    expect(formatPace(480)).toBe("8:00");
    expect(formatPace(null)).toBe("—");
  });

  it("weights the average by distance, not by run count", () => {
    // A 10-mile run at 9:00 and a 2-mile run at 7:00 average nearer 9:00.
    const avg = averagePaceSecPerMile([
      run({ localDate: "2026-08-03", distanceM: 10 * M_PER_MILE, durationS: 10 * 540 }),
      run({ localDate: "2026-08-05", distanceM: 2 * M_PER_MILE, durationS: 2 * 420 }),
    ])!;
    expect(avg).toBeCloseTo((10 * 540 + 2 * 420) / 12, 6);
    expect(avg).toBeGreaterThan(510);
  });

  it("ignores shakeouts too short to mean anything", () => {
    const avg = averagePaceSecPerMile([
      run({ localDate: "2026-08-03", distanceM: 6 * M_PER_MILE, durationS: 6 * 480 }),
      run({ localDate: "2026-08-04", distanceM: 1 * M_PER_MILE, durationS: 630 }),
    ])!;
    expect(avg).toBeCloseTo(480, 6);
  });
});

describe("effort classification", () => {
  const baseline = 8 * 60;

  it("calls a long run long even when it is fast", () => {
    expect(classifyRun(
      run({ localDate: "2026-08-08", distanceM: 10 * M_PER_MILE, durationS: 10 * 420 }),
      baseline,
    )).toBe("long");
  });

  it("calls a materially faster run hard", () => {
    expect(classifyRun(
      run({ localDate: "2026-08-05", distanceM: 4 * M_PER_MILE, durationS: 4 * 440 }),
      baseline,
    )).toBe("hard");
  });

  it("trusts Strava's relative effort when it is high", () => {
    expect(classifyRun(
      run({ localDate: "2026-08-05", sufferScore: 95 }),
      baseline,
    )).toBe("hard");
  });

  it("leaves an ordinary run easy", () => {
    expect(classifyRun(run({ localDate: "2026-08-05" }), baseline)).toBe("easy");
  });

  it("does not invent hard efforts with no baseline to compare against", () => {
    expect(classifyRun(run({ localDate: "2026-08-05", durationS: 5 * 300 }), null)).toBe("easy");
  });
});

describe("weeks", () => {
  it("starts weeks on Monday", () => {
    expect(weekStartOf("2026-08-05")).toBe("2026-08-03"); // Wednesday -> Monday
    expect(weekStartOf("2026-08-03")).toBe("2026-08-03"); // Monday -> itself
    expect(weekStartOf("2026-08-09")).toBe("2026-08-03"); // Sunday -> that Monday
  });

  it("totals only the runs inside the week", () => {
    const stats = weeklyRunStats([
      run({ localDate: "2026-08-03", distanceM: 5 * M_PER_MILE, durationS: 5 * 480 }),
      run({ localDate: "2026-08-06", distanceM: 6 * M_PER_MILE, durationS: 6 * 480, elevationM: 100 }),
      run({ localDate: "2026-07-30", distanceM: 99 * M_PER_MILE, durationS: 99 * 480 }),
    ], "2026-08-03");

    expect(stats.runs).toBe(2);
    expect(stats.distanceMi).toBeCloseTo(11, 1);
    expect(stats.longestRunMi).toBeCloseTo(6, 1);
    expect(stats.durationMin).toBe(88);
    expect(stats.elevationFt).toBe(328);
  });

  it("reports an empty week rather than throwing", () => {
    const stats = weeklyRunStats([], "2026-08-03");
    expect(stats).toMatchObject({ runs: 0, distanceMi: 0, longestRunMi: 0, avgPaceSecPerMile: null });
  });
});

describe("pace trend", () => {
  it("reads a genuine improvement as negative seconds per week", () => {
    // 30s/mi faster across four weeks.
    const runs = [
      run({ localDate: "2026-07-13", durationS: 5 * 510 }),
      run({ localDate: "2026-07-20", durationS: 5 * 500 }),
      run({ localDate: "2026-07-27", durationS: 5 * 490 }),
      run({ localDate: "2026-08-03", durationS: 5 * 485 }),
      run({ localDate: "2026-08-10", durationS: 5 * 480 }),
    ];
    const trend = paceTrend(runs)!;
    expect(trend.secPerMilePerWeek).toBeLessThan(0);
    expect(trend.reliable).toBe(true);
    expect(trend.runsUsed).toBe(5);
  });

  it("says so when the sample is too thin to call", () => {
    const trend = paceTrend([
      run({ localDate: "2026-08-03" }),
      run({ localDate: "2026-08-05", durationS: 5 * 470 }),
    ])!;
    expect(trend.reliable).toBe(false);
    expect(trend.runsUsed).toBeLessThan(MIN_RUNS_FOR_TREND);
  });

  it("has no answer from a single run", () => {
    expect(paceTrend([run({ localDate: "2026-08-03" })])).toBeNull();
  });

  it("is not dragged around by short shakeouts", () => {
    const steady = [
      run({ localDate: "2026-07-13", durationS: 5 * 480 }),
      run({ localDate: "2026-07-20", durationS: 5 * 480 }),
      run({ localDate: "2026-07-27", durationS: 5 * 480 }),
      run({ localDate: "2026-08-03", durationS: 5 * 480 }),
      run({ localDate: "2026-08-10", durationS: 5 * 480 }),
    ];
    const withShakeout = [
      ...steady,
      run({ localDate: "2026-08-11", distanceM: 1 * M_PER_MILE, durationS: 720 }),
    ];
    expect(paceTrend(withShakeout)!.secPerMilePerWeek)
      .toBeCloseTo(paceTrend(steady)!.secPerMilePerWeek, 6);
  });
});

describe("interference with lifting", () => {
  const baseline = 8 * 60;

  it("flags a hard run stacked next to a leg day", () => {
    const hits = detectInterference(
      [run({ localDate: "2026-08-04", sufferScore: 95 })],
      ["2026-08-05"],
      baseline,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ runDate: "2026-08-04", liftDate: "2026-08-05", daysApart: 1 });
  });

  it("flags it in the other order too", () => {
    const hits = detectInterference(
      [run({ localDate: "2026-08-06", sufferScore: 95 })],
      ["2026-08-05"],
      baseline,
    );
    expect(hits[0].daysApart).toBe(-1);
  });

  it("leaves easy mileage alone — that is the plan working", () => {
    expect(detectInterference(
      [run({ localDate: "2026-08-04" })],
      ["2026-08-05"],
      baseline,
    )).toEqual([]);
  });

  it("does not flag a leg day two clear days away", () => {
    expect(detectInterference(
      [run({ localDate: "2026-08-04", sufferScore: 95 })],
      ["2026-08-07"],
      baseline,
    )).toEqual([]);
  });
});

describe("the weekly rollup", () => {
  it("puts this week, last week, the trend and the collisions in one object", () => {
    const runs = [
      run({ localDate: "2026-07-27", distanceM: 4 * M_PER_MILE, durationS: 4 * 500 }),
      run({ localDate: "2026-07-29", distanceM: 5 * M_PER_MILE, durationS: 5 * 495 }),
      run({ localDate: "2026-08-03", distanceM: 5 * M_PER_MILE, durationS: 5 * 490 }),
      run({ localDate: "2026-08-05", distanceM: 4 * M_PER_MILE, durationS: 4 * 430 }),
      run({ localDate: "2026-08-08", distanceM: 10 * M_PER_MILE, durationS: 10 * 520 }),
    ];
    const week = summarizeRunningWeek(runs, ["2026-08-06"], "2026-08-03");

    expect(week.thisWeek.runs).toBe(3);
    expect(week.lastWeek.runs).toBe(2);
    expect(week.thisWeek.distanceMi).toBeCloseTo(19, 1);
    expect(week.trend!.runsUsed).toBe(5);
    expect(week.totalMi).toBeCloseTo(28, 1);
    // Tuesday's fast 4-miler sits next to Wednesday's leg day.
    expect(week.interference.map((h) => h.runDate)).toEqual(["2026-08-05"]);
  });

  it("survives a week with no running at all", () => {
    const week = summarizeRunningWeek([], [], "2026-08-03");
    expect(week.thisWeek.runs).toBe(0);
    expect(week.trend).toBeNull();
    expect(week.interference).toEqual([]);
  });
});

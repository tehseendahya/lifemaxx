import { describe, expect, it } from "vitest";

import { buildRunsModel, recentWeeks } from "./model";
import type { Bootstrap, RunDto } from "../../lib/types";

/**
 * `today` is 2026-10-25, a Sunday, so the current week is 2026-10-19..25.
 *
 * The pace figures are chosen so the arithmetic is checkable by hand: 1609.344
 * metres is a mile, so a run of N × 1609.344 m in N × 522 s is exactly
 * 8:42/mile at any distance.
 */

const TODAY = "2026-10-25";
const MILE = 1609.344;

function run(over: Partial<RunDto> = {}): RunDto {
  return {
    id: "r1",
    localDate: "2026-10-21",
    startedAt: "2026-10-21T11:00:00.000Z",
    name: "Morning run",
    type: "Run",
    distanceM: 5 * MILE,
    durationS: 5 * 522,
    elevationM: 30,
    avgHr: 150,
    sufferScore: 40,
    verdict: null,
    ...over,
  };
}

function bootstrap(runs: RunDto[], lowerBodyLiftDates: string[] = []): Bootstrap {
  return {
    today: TODAY,
    tz: "America/New_York",
    goalsText: "",
    target: { kcal: 2600, proteinG: 165, carbsG: 300, fatG: 80, mode: "maintain" },
    totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    mealCount: 0,
    volume: { summary: "", ranked: [] },
    tdee: { status: "insufficient_data", weighIns: 0, needed: 8 },
    activeWorkout: null,
    runs,
    lowerBodyLiftDates,
    gyms: [],
    catalogue: [],
    lastSets: {},
    // Not what this suite is about; the Today dashboard owns `history`.
    history: { days: [], mainLifts: [] },
  };
}

/** Five evenly spaced runs, which is exactly `MIN_RUNS_FOR_TREND`. */
function fiveRuns(): RunDto[] {
  return [0, 1, 2, 3, 4].map((i) => run({
    id: `r${i}`,
    localDate: `2026-10-${String(15 + i).padStart(2, "0")}`,
    startedAt: `2026-10-${String(15 + i).padStart(2, "0")}T11:00:00.000Z`,
    // Each run 10 seconds per mile quicker than the last.
    durationS: Math.round(5 * (560 - i * 10)),
  }));
}

describe("empty state", () => {
  it("reports empty rather than a week of zeroes", () => {
    const m = buildRunsModel(bootstrap([]));
    expect(m.isEmpty).toBe(true);
    expect(m.subtitle).toBeNull();
    expect(m.runs).toEqual([]);
    expect(m.interference).toBeNull();
  });

  it("still produces a well-formed week card, so the screen cannot crash on it", () => {
    const m = buildRunsModel(bootstrap([]));
    expect(m.week).toHaveLength(6);
    expect(m.week[0]).toEqual({ label: "Miles", value: "0", hint: "0 last week" });
    expect(m.week[1].value).toBe("—");
    expect(m.trend.figure).toBeNull();
    expect(m.trend.lead).toBe("Not enough runs yet to say anything about pace.");
  });
});

describe("this week", () => {
  it("reads every figure off weeklyRunStats", () => {
    const m = buildRunsModel(bootstrap([
      run(),
      run({ id: "r2", localDate: "2026-10-24", startedAt: "2026-10-24T11:00:00.000Z", distanceM: 3 * MILE, durationS: 3 * 522, elevationM: 0, avgHr: null }),
      run({ id: "old", localDate: "2026-10-14", startedAt: "2026-10-14T11:00:00.000Z", distanceM: 4 * MILE, durationS: 4 * 522 }),
    ]));

    expect(m.week.map((s) => [s.label, s.value])).toEqual([
      ["Miles", "8"],
      ["Avg pace", "8:42"],
      ["Longest", "5"],
      ["Time", "70"],      // 8 miles at 8:42 is 69.6 minutes
      ["Climb", "98"],     // 30 m
      ["Hard / long", "0"],
    ]);
    expect(m.week[0].hint).toBe("4 last week");
    expect(m.week[2].hint).toBe("2 runs");
    expect(m.subtitle).toBe("12 miles logged in the last 8 weeks");
  });
});

describe("pace trend", () => {
  it("refuses to draw a line through two runs", () => {
    const m = buildRunsModel(bootstrap([
      run({ id: "a", localDate: "2026-10-20", startedAt: "2026-10-20T11:00:00.000Z" }),
      run({ id: "b", localDate: "2026-10-22", startedAt: "2026-10-22T11:00:00.000Z", durationS: 5 * 500 }),
    ]));
    expect(m.trend.figure).toBeNull();
    expect(m.trend.tone).toBe("muted");
    expect(m.trend.lead).toBe("Pace trend needs 3 more runs before it means anything.");
  });

  it("uses the singular when one more run would do it", () => {
    const four = fiveRuns().slice(0, 4);
    const m = buildRunsModel(bootstrap(four));
    expect(m.trend.lead).toBe("Pace trend needs 1 more run before it means anything.");
  });

  it("quotes the slope once the sample clears MIN_RUNS_FOR_TREND", () => {
    const m = buildRunsModel(bootstrap(fiveRuns()));
    expect(m.trend.tone).toBe("good");
    expect(m.trend.lead).toBe("Pace trending ");
    // 10 s/mi per day over consecutive days is 70 s/mi per week.
    expect(m.trend.figure).toBe("70s/mi faster");
    expect(m.trend.tail).toBe(" per week, over 5 runs.");
  });

  it("marks a slowing trend as warn, not good", () => {
    const slowing = fiveRuns().map((r, i) => ({ ...r, durationS: Math.round(5 * (500 + i * 10)) }));
    const m = buildRunsModel(bootstrap(slowing));
    expect(m.trend.tone).toBe("warn");
    expect(m.trend.figure).toBe("70s/mi slower");
  });
});

describe("interference", () => {
  it("is absent when nothing stacked", () => {
    expect(buildRunsModel(bootstrap([run()], ["2026-10-13"])).interference).toBeNull();
  });

  it("names the run, the lift and the gap", () => {
    // 10.1 miles is past LONG_RUN_MI, so the run is never classified easy.
    const long = run({ id: "long", localDate: "2026-10-24", startedAt: "2026-10-24T11:00:00.000Z", distanceM: 16254.374, durationS: 5535 });
    const m = buildRunsModel(bootstrap([long], ["2026-10-25"]));

    expect(m.interference?.headline).toBe(
      "Hard running landed within a day of a leg session once this week.",
    );
    expect(m.interference?.rows).toEqual([
      { key: "0-2026-10-24-2026-10-25", text: "long run 2026-10-24 · legs 2026-10-25 · legs next day" },
    ]);
  });

  it("says the lift came first when it did", () => {
    const long = run({ id: "long", localDate: "2026-10-24", startedAt: "2026-10-24T11:00:00.000Z", distanceM: 16254.374, durationS: 5535 });
    const m = buildRunsModel(bootstrap([long], ["2026-10-23"]));
    expect(m.interference?.rows[0].text).toContain("legs the day before");
  });

  it("counts repeats", () => {
    const a = run({ id: "a", localDate: "2026-10-21", startedAt: "2026-10-21T11:00:00.000Z", distanceM: 16254.374, durationS: 5535 });
    const b = run({ id: "b", localDate: "2026-10-24", startedAt: "2026-10-24T11:00:00.000Z", distanceM: 16254.374, durationS: 5535 });
    const m = buildRunsModel(bootstrap([a, b], ["2026-10-21", "2026-10-24"]));
    expect(m.interference?.headline).toContain("2 times this week");
    expect(m.interference?.rows).toHaveLength(2);
  });

  it("ignores an easy run next to a leg day", () => {
    // Two identical easy runs, so neither is 4% faster than the baseline they
    // jointly define, and neither clears the suffer-score threshold.
    const m = buildRunsModel(bootstrap([
      run({ id: "a", localDate: "2026-10-20", startedAt: "2026-10-20T11:00:00.000Z" }),
      run({ id: "b", localDate: "2026-10-22", startedAt: "2026-10-22T11:00:00.000Z" }),
    ], ["2026-10-20", "2026-10-22"]));
    expect(m.interference).toBeNull();
  });
});

describe("run rows", () => {
  it("orders newest first and drops the figures a run does not carry", () => {
    const m = buildRunsModel(bootstrap([
      run({ id: "older", localDate: "2026-10-20", startedAt: "2026-10-20T11:00:00.000Z" }),
      run({ id: "newer", localDate: "2026-10-24", startedAt: "2026-10-24T11:00:00.000Z", elevationM: 0, avgHr: null, name: "", verdict: "Solid steady effort." }),
    ]));

    expect(m.runs.map((r) => r.id)).toEqual(["newer", "older"]);
    expect(m.runs[0].name).toBe("Run");
    expect(m.runs[0].figures).toEqual(["5 mi", "8:42/mi", "44 min"]);
    expect(m.runs[0].verdict).toBe("Solid steady effort.");
    expect(m.runs[1].figures).toEqual(["5 mi", "8:42/mi", "44 min", "98 ft", "150 bpm"]);
    expect(m.runs[1].verdict).toBeNull();
  });

  it("classifies effort with the shared domain function", () => {
    const m = buildRunsModel(bootstrap([
      run({ id: "easy" }),
      // Same pace as the easy run, so the long run does not drag the baseline
      // that `classifyRun` compares the easy one against. `long` wins on
      // distance alone, which is the ordering the domain function guarantees.
      run({ id: "long", localDate: "2026-10-24", startedAt: "2026-10-24T11:00:00.000Z", distanceM: 10 * MILE, durationS: 10 * 522 }),
    ]));
    const byId = new Map(m.runs.map((r) => [r.id, r.effort]));
    expect(byId.get("long")).toBe("long");
    expect(byId.get("easy")).toBe("easy");
  });
});

describe("recentWeeks", () => {
  it("anchors eight buckets on Mondays, newest first", () => {
    // Every bucket is populated here, so none is trimmed.
    const everyWeek = [0, 1, 2, 3, 4, 5, 6, 7].map((w) => {
      const d = new Date("2026-10-19T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - w * 7);
      const iso = d.toISOString().slice(0, 10);
      return run({ id: `w${w}`, localDate: iso, startedAt: `${iso}T11:00:00.000Z` });
    });

    expect(recentWeeks(everyWeek, TODAY).map((r) => r.weekStart)).toEqual([
      "2026-10-19", "2026-10-12", "2026-10-05", "2026-09-28",
      "2026-09-21", "2026-09-14", "2026-09-07", "2026-08-31",
    ]);
  });

  it("keeps a rest week between two training weeks", () => {
    const rows = recentWeeks([
      run(),
      run({ id: "old", localDate: "2026-10-05", startedAt: "2026-10-05T11:00:00.000Z" }),
    ], TODAY);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ weekStart: "2026-10-19", distanceMi: 5, avgPace: "8:42", runs: 1 });
    // The gap stays, so three weeks of training does not read as two.
    expect(rows[1]).toEqual({ weekStart: "2026-10-12", distanceMi: 0, avgPace: "—", runs: 0 });
    expect(rows[2].weekStart).toBe("2026-10-05");
  });

  it("drops the weeks before the account had any runs", () => {
    // Otherwise a three-week-old account shows six rows of "0 mi · —", which
    // reads as a broken screen rather than as a short history.
    expect(recentWeeks([run()], TODAY)).toEqual([
      { weekStart: "2026-10-19", distanceMi: 5, avgPace: "8:42", runs: 1 },
    ]);
    expect(recentWeeks([], TODAY)).toEqual([]);
  });
});

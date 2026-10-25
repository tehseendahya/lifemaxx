import { describe, expect, it } from "vitest";

import { buildTodayModel, formatLongDate } from "./model";
import type { Bootstrap, RunDto } from "../../lib/types";

/**
 * The five states that crash a dashboard.
 *
 * Not "does the card render" — there is no renderer here and no simulator in
 * this container. These assert the arithmetic and the copy for the cases the
 * demo data does not cover: a brand new account with no runs, no meals and no
 * calorie target, an account below the TDEE weigh-in floor, and the one case
 * that only exists because this app holds both halves of the data — hard
 * running landing on a leg day.
 *
 * `today` is 2026-10-25, a Sunday, so the current running week is
 * 2026-10-19..25 and the previous one is 2026-10-12..18.
 */

const TODAY = "2026-10-25";

function run(over: Partial<RunDto> = {}): RunDto {
  return {
    id: "r1",
    localDate: "2026-10-24",
    startedAt: "2026-10-24T11:00:00.000Z",
    name: "Morning run",
    type: "Run",
    distanceM: 8046.72, // 5.0 mi
    durationS: 2610, // 8:42/mi
    elevationM: 30,
    avgHr: 150,
    sufferScore: 40,
    verdict: null,
    ...over,
  };
}

function bootstrap(over: Partial<Bootstrap> = {}): Bootstrap {
  return {
    today: TODAY,
    tz: "America/New_York",
    goalsText: "Half marathon in the fall.",
    target: { kcal: 2600, proteinG: 165, carbsG: 300, fatG: 80, mode: "maintain" },
    totals: { kcal: 1375.4, proteinG: 79, carbsG: 115, fatG: 68 },
    mealCount: 2,
    volume: {
      summary: "Rear Delts and Lats are owed sets this week.",
      ranked: [
        { muscle: "rear_delt", label: "Rear Delts", setsLast7d: 0, daysSinceTrained: 9, score: 1 },
        { muscle: "trap", label: "Traps", setsLast7d: 0, daysSinceTrained: null, score: 1 },
        { muscle: "lat", label: "Lats", setsLast7d: 1.5, daysSinceTrained: 5, score: 0.765 },
        { muscle: "chest", label: "Chest", setsLast7d: 8, daysSinceTrained: 2, score: 0.2001 },
        { muscle: "quad", label: "Quads", setsLast7d: 12, daysSinceTrained: 1, score: 0.05 },
      ],
    },
    tdee: {
      status: "ok",
      tdee: 2377,
      marginKcal: 11,
      trendKgPerWeek: -0.16431483055858312,
      currentKg: 82.08537140127595,
      meanIntake: 2196,
      weighIns: 13,
    },
    activeWorkout: null,
    runs: [],
    lowerBodyLiftDates: [],
    gyms: [],
    catalogue: [],
    lastSets: {},
    ...over,
  };
}

describe("formatLongDate", () => {
  it("reads the server's date, not the device clock", () => {
    expect(formatLongDate(TODAY)).toBe("Sunday, October 25");
    expect(formatLongDate("2026-01-01")).toBe("Thursday, January 1");
  });

  it("falls back to the raw string rather than rendering Invalid Date", () => {
    expect(formatLongDate("not-a-date")).toBe("not-a-date");
  });
});

describe("fuel", () => {
  it("rounds the day's calories and names the target", () => {
    const m = buildTodayModel(bootstrap());
    expect(m.fuel.kcal).toBe(1375);
    expect(m.fuel.targetLine).toBe("of 2600 kcal");
    expect(m.fuel.mealLine).toBe("2 meals logged →");
  });

  it("says it is still calibrating rather than inventing a calorie target", () => {
    const m = buildTodayModel(bootstrap({
      target: { kcal: null, proteinG: 150, carbsG: null, fatG: null, mode: "calibrating" },
    }));
    expect(m.fuel.targetLine).toBe("kcal — no target yet, still calibrating");
    // Protein survives calibration — it is the one figure that is already right.
    expect(m.fuel.macros[0]).toEqual({ label: "Protein", value: 79, target: 150 });
    expect(m.fuel.macros[1].target).toBeNull();
    expect(m.fuel.macros[2].target).toBeNull();
  });

  it("asks for the first meal in the singular", () => {
    const zero = buildTodayModel(bootstrap({
      mealCount: 0,
      totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    }));
    expect(zero.fuel.mealLine).toBe("Log your first meal →");
    expect(zero.fuel.kcal).toBe(0);

    const one = buildTodayModel(bootstrap({ mealCount: 1 }));
    expect(one.fuel.mealLine).toBe("1 meal logged →");
  });
});

describe("train next", () => {
  it("keeps the server's sentence and the four muscles over the threshold", () => {
    const m = buildTodayModel(bootstrap());
    expect(m.trainNext.summary).toBe("Rear Delts and Lats are owed sets this week.");
    expect(m.trainNext.rows.map((r) => r.muscle)).toEqual(["rear_delt", "trap", "lat", "chest"]);
    expect(m.trainNext.emptyNote).toBeNull();
  });

  it("renders set debt against the weekly target, and 'never' for an untrained muscle", () => {
    const rows = buildTodayModel(bootstrap()).trainNext.rows;
    expect(rows[0].figure).toBe("0/10 sets · 9d ago");
    expect(rows[1].figure).toBe("0/10 sets · never");
    expect(rows[2].figure).toBe("1.5/10 sets · 5d ago");
  });

  it("says so when nothing is behind instead of showing a blank card", () => {
    const m = buildTodayModel(bootstrap({
      volume: {
        summary: "Everything's in range this week. Train whatever you feel like.",
        ranked: [{ muscle: "chest", label: "Chest", setsLast7d: 14, daysSinceTrained: 1, score: 0.1 }],
      },
    }));
    expect(m.trainNext.rows).toEqual([]);
    expect(m.trainNext.emptyNote).toBe("Nothing is behind. Train whatever you feel like.");
  });

  it("offers to resume rather than to start when a session is open", () => {
    expect(buildTodayModel(bootstrap()).trainNext.liftLine).toBe("Start a lift →");

    const live = buildTodayModel(bootstrap({
      activeWorkout: { id: "w1", startedAt: "2026-10-25T06:19:54.951Z" },
    }));
    expect(live.sessionInProgress).toBe(true);
    expect(live.trainNext.liftLine).toBe("Resume session →");
  });
});

describe("running", () => {
  it("drops the card entirely when there are no runs", () => {
    expect(buildTodayModel(bootstrap()).running).toBeNull();
  });

  it("reports this week's mileage, pace and count", () => {
    const m = buildTodayModel(bootstrap({ runs: [run()] }));
    expect(m.running).not.toBeNull();
    expect(m.running?.distanceMi).toBe(5);
    expect(m.running?.detail).toBe("mi · 8:42/mi · 1 run");
  });

  it("names last week's mileage once there is a last week", () => {
    const m = buildTodayModel(bootstrap({
      runs: [run(), run({ id: "r0", localDate: "2026-10-14", distanceM: 16093.44 })],
    }));
    expect(m.running?.warning).toBeNull();
    expect(m.running?.note).toBe("10 mi last week.");
  });

  it("admits it is the first week rather than showing 0 mi last week", () => {
    const m = buildTodayModel(bootstrap({ runs: [run()] }));
    expect(m.running?.note).toBe("First week of logged mileage.");
  });

  it("warns about a hard run on a leg day, and drops last week's mileage for it", () => {
    // A long run (>= 8 mi) is never classified easy, so it is eligible for
    // interference regardless of pace — and the squat day is the same date.
    const m = buildTodayModel(bootstrap({
      runs: [
        run({ id: "long", localDate: "2026-10-24", distanceM: 16254.374, durationS: 5535 }),
        run({ id: "last-week", localDate: "2026-10-14", distanceM: 8046.72 }),
      ],
      lowerBodyLiftDates: ["2026-10-24"],
    }));
    expect(m.running?.warning).toBe("Hard running stacked on a leg day this week.");
    // The warning displaces the mileage line; it does not sit beside it.
    expect(m.running?.note).toBeNull();
  });

  it("counts repeat interference in the sentence", () => {
    const m = buildTodayModel(bootstrap({
      runs: [
        run({ id: "a", localDate: "2026-10-21", distanceM: 16254.374, durationS: 5535 }),
        run({ id: "b", localDate: "2026-10-24", distanceM: 16254.374, durationS: 5535 }),
      ],
      lowerBodyLiftDates: ["2026-10-21", "2026-10-24"],
    }));
    expect(m.running?.warning).toBe("Hard running stacked on a leg day 2 times this week.");
  });
});

describe("measured maintenance", () => {
  it("shows the number, its confidence range and the signed trend", () => {
    const m = buildTodayModel(bootstrap());
    expect(m.maintenance).toEqual({
      status: "ok",
      tdee: "2377",
      hint: "±11 kcal · from 13 weigh-ins",
      trend: "-0.4 lb/wk",
    });
  });

  it("signs a gain explicitly", () => {
    const m = buildTodayModel(bootstrap({
      tdee: {
        status: "ok", tdee: 2900, marginKcal: 90, trendKgPerWeek: 0.18,
        currentKg: 80, meanIntake: 3100, weighIns: 11,
      },
    }));
    expect(m.maintenance).toMatchObject({ trend: "+0.4 lb/wk" });
  });

  it("renders no TDEE figure at all below the weigh-in floor", () => {
    const m = buildTodayModel(bootstrap({
      tdee: { status: "insufficient_data", weighIns: 5, needed: 8 },
    }));
    expect(m.maintenance).toEqual({
      status: "insufficient",
      note: "Not enough weigh-ins for a reliable number — 5 of 8. "
        + "Weigh in most mornings and this fills itself in.",
    });
    expect(JSON.stringify(m.maintenance)).not.toContain("tdee");
  });
});

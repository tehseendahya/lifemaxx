import { describe, expect, it } from "vitest";

import { barHeightPct, buildExerciseView, formatDay } from "./model";
import type { ExerciseHistory, HistorySet } from "@/lib/types";

const set = (over: Partial<HistorySet> = {}): HistorySet => ({
  reps: 5,
  weightLb: 185,
  rpe: null,
  toFailure: false,
  isWarmup: false,
  felt: "normal",
  note: "",
  ...over,
});

const payload = (over: Partial<ExerciseHistory> = {}): ExerciseHistory => ({
  exercise: {
    id: "4b5514ef-9b80-4947-9a9b-d743b3c0924c",
    name: "Barbell Bench Press",
    slug: "barbell-bench-press",
    incrementLb: 5,
    equipment: "barbell",
  },
  history: [],
  bestE1rmLb: null,
  ...over,
});

describe("formatDay", () => {
  it("formats an ISO date without touching the device clock", () => {
    expect(formatDay("2026-10-25")).toBe("Sun, Oct 25");
    expect(formatDay("2026-01-01")).toBe("Thu, Jan 1");
    expect(formatDay("2026-12-31")).toBe("Thu, Dec 31");
  });

  it("returns the input unchanged when it is not a date", () => {
    expect(formatDay("")).toBe("");
    expect(formatDay("nonsense")).toBe("nonsense");
  });
});

describe("buildExerciseView", () => {
  it("survives an exercise with no history at all", () => {
    const v = buildExerciseView(payload());
    expect(v.sessions).toEqual([]);
    expect(v.trend).toEqual([]);
    expect(v.peakE1rmLb).toBeNull();
    expect(v.changePct).toBeNull();
    expect(v.subtitle).toBe("barbell · 5 lb increment");
  });

  it("excludes warmups from both the volume and the trend", () => {
    const v = buildExerciseView(payload({
      history: [{
        date: "2026-10-23",
        sets: [set({ weightLb: 95, isWarmup: true }), set({ weightLb: 185 })],
      }],
    }));

    expect(v.sessions[0].sets).toHaveLength(1);
    expect(v.sessions[0].volumeLb).toBe(185 * 5);
    expect(v.trend).toHaveLength(1);
    // 185 * (1 + 5/30)
    expect(v.trend[0].e1rmLb).toBeCloseTo(215.83, 2);
  });

  it("yields a session with no trend point when it was warmups only", () => {
    const v = buildExerciseView(payload({
      history: [{ date: "2026-10-23", sets: [set({ isWarmup: true })] }],
    }));

    expect(v.sessions).toHaveLength(1);
    expect(v.sessions[0].volumeLb).toBe(0);
    expect(v.trend).toEqual([]);
    expect(v.peakE1rmLb).toBeNull();
  });

  it("drops a set outside Epley's reliable rep range from the trend but not the history", () => {
    const v = buildExerciseView(payload({
      history: [{ date: "2026-10-23", sets: [set({ reps: 20, weightLb: 95 })] }],
    }));

    expect(v.sessions[0].sets).toHaveLength(1);
    expect(v.sessions[0].volumeLb).toBe(95 * 20);
    expect(v.trend).toEqual([]);
  });

  it("reverses the trend to oldest-first while leaving the history newest-first", () => {
    const v = buildExerciseView(payload({
      history: [
        { date: "2026-10-23", sets: [set({ weightLb: 185 })] },
        { date: "2026-10-18", sets: [set({ weightLb: 180 })] },
        { date: "2026-10-13", sets: [set({ weightLb: 175 })] },
      ],
    }));

    expect(v.sessions.map((s) => s.date)).toEqual(["2026-10-23", "2026-10-18", "2026-10-13"]);
    expect(v.trend.map((p) => p.date)).toEqual(["2026-10-13", "2026-10-18", "2026-10-23"]);
    // Improving, so the change must read positive — this is the assertion that
    // fails if anyone "tidies up" the reverse().
    expect(v.changePct).toBeGreaterThan(0);
    expect(v.changePct).toBeCloseTo(((185 - 175) / 175) * 100, 6);
  });

  it("reports a decline as negative", () => {
    const v = buildExerciseView(payload({
      history: [
        { date: "2026-10-23", sets: [set({ weightLb: 170 })] },
        { date: "2026-10-18", sets: [set({ weightLb: 185 })] },
      ],
    }));
    expect(v.changePct).toBeLessThan(0);
  });

  it("gives no percentage from a single trend point", () => {
    const v = buildExerciseView(payload({
      history: [{ date: "2026-10-23", sets: [set()] }],
    }));
    expect(v.trend).toHaveLength(1);
    expect(v.changePct).toBeNull();
    expect(v.peakE1rmLb).not.toBeNull();
  });

  it("does not divide by zero on a bodyweight-at-zero first session", () => {
    const v = buildExerciseView(payload({
      history: [
        { date: "2026-10-23", sets: [set({ weightLb: 20 })] },
        { date: "2026-10-18", sets: [set({ weightLb: 0 })] },
      ],
    }));
    expect(v.changePct).toBeNull();
    expect(Number.isFinite(v.peakE1rmLb ?? NaN)).toBe(true);
  });

  it("takes the peak from the window, not from the newest session", () => {
    const v = buildExerciseView(payload({
      history: [
        { date: "2026-10-23", sets: [set({ weightLb: 170 })] },
        { date: "2026-10-18", sets: [set({ weightLb: 200 })] },
      ],
    }));
    expect(v.peakE1rmLb).toBeCloseTo(200 * (1 + 5 / 30), 6);
  });
});

describe("barHeightPct", () => {
  it("scales against the peak", () => {
    expect(barHeightPct(100, 200)).toBe(50);
    expect(barHeightPct(200, 200)).toBe(100);
  });

  it("floors at 8 so a small bar is still a visible mark", () => {
    expect(barHeightPct(1, 1000)).toBe(8);
  });

  it("does not divide by a null or zero peak", () => {
    expect(barHeightPct(100, null)).toBe(8);
    expect(barHeightPct(100, 0)).toBe(8);
  });
});

/**
 * The cue on the detail screen.
 *
 * `GET /api/mobile/exercise?id=` has returned this field since the cue backend
 * landed, and nothing consumed it — the route's comment claimed this screen
 * rendered it while the screen had no reference to the field. These pin the
 * consumption so it cannot quietly fall out again.
 */
describe("the carry-forward cue", () => {
  it("carries the owner's own words through, line breaks and all", () => {
    const v = buildExerciseView(payload({ cue: "elbows tucked\npause on chest" }));
    expect(v.cue).toBe("elbows tucked\npause on chest");
  });

  it("is null when this lift has no cue", () => {
    expect(buildExerciseView(payload({ cue: null })).cue).toBeNull();
  });

  it("is null when the server predates the field entirely", () => {
    // The field is optional on the wire type. `undefined` reaching a <Text>
    // renders nothing but is not something to rely on.
    expect(buildExerciseView(payload()).cue).toBeNull();
  });

  it("folds an empty string to null rather than drawing an empty block", () => {
    // The server never stores "" — absence is its only representation of "no
    // cue" — so if one arrives it means the same thing.
    expect(buildExerciseView(payload({ cue: "" })).cue).toBeNull();
  });
});

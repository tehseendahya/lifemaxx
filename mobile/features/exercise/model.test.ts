import { describe, expect, it } from "vitest";

import {
  buildExerciseView, firstSessionLine, formatDay, formatShort, goalTargetLb, metricFor,
  prSessions, progressSeries, topSetOf,
} from "./model";
import type { GoalClaim } from "../today/goals";
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

type Session = ExerciseHistory["history"][number];

const session = (date: string, sets: HistorySet[], workoutId?: string): Session =>
  workoutId === undefined ? { date, sets } : { date, sets, workoutId };

const BENCH = {
  id: "4b5514ef-9b80-4947-9a9b-d743b3c0924c",
  name: "Barbell Bench Press",
  slug: "barbell-bench-press",
  incrementLb: 5,
  equipment: "barbell",
};

const CURL = {
  id: "a9c1e7e0-0f6e-4d0c-9a57-1b0a8f5f6f11",
  name: "Preacher Curl",
  slug: "preacher-curl",
  incrementLb: 5,
  equipment: "barbell",
};

const PUSHUP = {
  id: "7d0f0a4e-3f43-4c39-8c0f-2c2a0c7b9e10",
  name: "Push-Up",
  slug: "push-up",
  incrementLb: 5,
  equipment: "bodyweight",
};

const payload = (over: Partial<ExerciseHistory> = {}): ExerciseHistory => ({
  exercise: BENCH,
  history: [],
  bestE1rmLb: null,
  ...over,
});

describe("formatDay / formatShort", () => {
  it("formats an ISO date without touching the device clock", () => {
    expect(formatDay("2026-10-25")).toBe("Sun, Oct 25");
    expect(formatDay("2026-01-01")).toBe("Thu, Jan 1");
    expect(formatShort("2026-09-03")).toBe("Sep 3");
  });

  it("returns the input unchanged when it is not a date", () => {
    expect(formatDay("")).toBe("");
    expect(formatDay("nonsense")).toBe("nonsense");
    expect(formatShort("nonsense")).toBe("nonsense");
  });
});

describe("metricFor", () => {
  it("is e1rm for a barbell main lift", () => {
    expect(metricFor(BENCH, [session("2026-10-20", [set()])])).toBe("e1rm");
  });

  it("is e1rm for a main lift even with no history — the list decides, not the data", () => {
    expect(metricFor(BENCH, [])).toBe("e1rm");
  });

  it("is topSet for anything off the list, barbell or not", () => {
    // Preacher curl is done on a barbell and is still not an e1RM lift.
    expect(metricFor(CURL, [session("2026-10-20", [set({ weightLb: 60, reps: 10 })])])).toBe("topSet");
    expect(metricFor({ slug: "dumbbell-bench-press" }, [session("2026-10-20", [set()])])).toBe("topSet");
  });

  it("is reps when every working set is at zero load", () => {
    const sessions = [session("2026-10-20", [set({ weightLb: 0, reps: 12 }), set({ weightLb: 0, reps: 10 })])];
    expect(metricFor(PUSHUP, sessions)).toBe("reps");
  });

  it("ignores a loaded warmup when deciding it is a reps lift", () => {
    const sessions = [session("2026-10-20", [
      set({ weightLb: 25, isWarmup: true }),
      set({ weightLb: 0, reps: 12 }),
    ])];
    expect(metricFor(PUSHUP, sessions)).toBe("reps");
  });

  it("goes back to topSet once any working set carries load", () => {
    const sessions = [
      session("2026-10-23", [set({ weightLb: 25, reps: 8 })]),
      session("2026-10-20", [set({ weightLb: 0, reps: 12 })]),
    ];
    expect(metricFor(PUSHUP, sessions)).toBe("topSet");
  });

  it("is topSet, not reps, with no working sets at all", () => {
    expect(metricFor(CURL, [])).toBe("topSet");
    expect(metricFor(CURL, [session("2026-10-20", [set({ isWarmup: true, weightLb: 0 })])])).toBe("topSet");
  });
});

describe("topSetOf", () => {
  it("takes the heaviest working set", () => {
    expect(topSetOf([set({ weightLb: 185, reps: 5 }), set({ weightLb: 195, reps: 2 })]))
      .toEqual({ weightLb: 195, reps: 2 });
  });

  it("breaks a weight tie on reps, whichever order they came in", () => {
    expect(topSetOf([set({ weightLb: 50, reps: 8 }), set({ weightLb: 50, reps: 10 })]))
      .toEqual({ weightLb: 50, reps: 10 });
    expect(topSetOf([set({ weightLb: 50, reps: 10 }), set({ weightLb: 50, reps: 8 })]))
      .toEqual({ weightLb: 50, reps: 10 });
  });

  it("never picks a warmup, however heavy", () => {
    expect(topSetOf([set({ weightLb: 225, isWarmup: true }), set({ weightLb: 185 })]))
      .toEqual({ weightLb: 185, reps: 5 });
  });

  it("is null for warmups only", () => {
    expect(topSetOf([set({ isWarmup: true })])).toBeNull();
    expect(topSetOf([])).toBeNull();
  });
});

describe("progressSeries", () => {
  const sessions = [
    session("2026-10-23", [set({ weightLb: 185, reps: 5 })]),
    session("2026-10-18", [set({ weightLb: 180, reps: 5 })]),
    session("2026-10-13", [set({ weightLb: 175, reps: 5 })]),
  ];

  it("runs oldest first while the history stays newest first", () => {
    expect(progressSeries("topSet", sessions).map((p) => p.date))
      .toEqual(["2026-10-13", "2026-10-18", "2026-10-23"]);
  });

  it("plots top-set weight for topSet", () => {
    expect(progressSeries("topSet", sessions).map((p) => p.value)).toEqual([175, 180, 185]);
  });

  it("plots Epley for e1rm, from pounds", () => {
    expect(progressSeries("e1rm", sessions)[2].value).toBeCloseTo(185 * (1 + 5 / 30), 6);
  });

  it("drops a session outside Epley's reliable range from an e1rm series only", () => {
    const highRep = [session("2026-10-23", [set({ reps: 20, weightLb: 95 })])];
    expect(progressSeries("e1rm", highRep)).toEqual([]);
    expect(progressSeries("topSet", highRep).map((p) => p.value)).toEqual([95]);
  });

  it("plots the best rep count for reps", () => {
    const s = [session("2026-10-20", [set({ weightLb: 0, reps: 12 }), set({ weightLb: 0, reps: 15 })])];
    expect(progressSeries("reps", s).map((p) => p.value)).toEqual([15]);
  });
});

describe("prSessions", () => {
  it("marks a session that beats every earlier one, and never the first", () => {
    // Newest first, as sent. Oldest is index 3.
    const sessions = [
      session("2026-10-23", [set({ weightLb: 190 })]), // beats 185 → PR
      session("2026-10-18", [set({ weightLb: 180 })]), // below 185 → not
      session("2026-10-13", [set({ weightLb: 185 })]), // beats 175 → PR
      session("2026-10-08", [set({ weightLb: 175 })]), // first → never
    ];
    expect([...prSessions("topSet", sessions)].sort()).toEqual([0, 2]);
  });

  it("does not call matching the best a PR", () => {
    const sessions = [
      session("2026-10-18", [set({ weightLb: 185 })]),
      session("2026-10-13", [set({ weightLb: 185 })]),
    ];
    expect(prSessions("topSet", sessions).size).toBe(0);
  });

  it("counts more reps at the same top weight as a PR", () => {
    const sessions = [
      session("2026-10-18", [set({ weightLb: 185, reps: 7 })]),
      session("2026-10-13", [set({ weightLb: 185, reps: 5 })]),
    ];
    expect([...prSessions("topSet", sessions)]).toEqual([0]);
  });

  it("compares against the best so far, not the session just before", () => {
    const sessions = [
      session("2026-10-23", [set({ weightLb: 185 })]), // beats 180 but not 190
      session("2026-10-18", [set({ weightLb: 180 })]),
      session("2026-10-13", [set({ weightLb: 190 })]),
    ];
    expect(prSessions("topSet", sessions).size).toBe(0);
  });

  it("uses e1RM on an e1rm lift, so a lighter set with more reps can be the PR", () => {
    const sessions = [
      session("2026-10-18", [set({ weightLb: 175, reps: 8 })]), // 221.7
      session("2026-10-13", [set({ weightLb: 185, reps: 5 })]), // 215.8
    ];
    expect([...prSessions("e1rm", sessions)]).toEqual([0]);
    expect(prSessions("topSet", sessions).size).toBe(0);
  });

  it("skips a session with no value rather than resetting the record", () => {
    const sessions = [
      session("2026-10-23", [set({ weightLb: 180 })]),
      session("2026-10-18", [set({ isWarmup: true, weightLb: 300 })]),
      session("2026-10-13", [set({ weightLb: 185 })]),
    ];
    expect(prSessions("topSet", sessions).size).toBe(0);
  });
});

describe("firstSessionLine", () => {
  it("prints the one set as a figure and says what comes next", () => {
    const [point] = progressSeries("topSet", [session("2026-10-20", [set({ weightLb: 50, reps: 10 })])]);
    expect(firstSessionLine("topSet", point))
      .toBe("First logged Oct 20: 50 × 10. Your trend starts with the next session.");
  });

  it("prints reps for a reps lift", () => {
    const [point] = progressSeries("reps", [session("2026-10-20", [set({ weightLb: 0, reps: 12 })])]);
    expect(firstSessionLine("reps", point))
      .toBe("First logged Oct 20: 12 reps. Your trend starts with the next session.");
  });
});

describe("goalTargetLb", () => {
  const claim = (exerciseId: string, targetLb: number, byDate: string | null): GoalClaim => ({
    kind: "lift", sentence: "", exerciseId, exerciseName: "", targetLb, byDate,
  });

  it("takes the nearest deadline on this lift", () => {
    const claims = [claim(BENCH.id, 225, "2027-05-01"), claim(BENCH.id, 205, "2026-12-01")];
    expect(goalTargetLb(BENCH.id, claims)).toBe(205);
  });

  it("ranks an undated target after a dated one", () => {
    expect(goalTargetLb(BENCH.id, [claim(BENCH.id, 250, null), claim(BENCH.id, 205, "2026-12-01")]))
      .toBe(205);
  });

  it("ignores other lifts and rep targets", () => {
    const reps: GoalClaim = {
      kind: "lift_reps", sentence: "", exerciseId: BENCH.id, exerciseName: "", targetReps: 10,
      loadLb: 45, byDate: null,
    };
    expect(goalTargetLb(BENCH.id, [claim("other", 300, null), reps])).toBeNull();
  });
});

describe("buildExerciseView", () => {
  it("draws nothing for a lift with no sessions", () => {
    const v = buildExerciseView(payload());
    expect(v.progress).toEqual({ kind: "none" });
    expect(v.sessions).toEqual([]);
    expect(v.subtitle).toBe("barbell · 5 lb steps");
  });

  it("is a sentence, not a chart, after one session", () => {
    const v = buildExerciseView(payload({ history: [session("2026-10-20", [set()])] }));
    expect(v.progress).toEqual({
      kind: "single",
      label: "Estimated 1RM",
      line: "First logged Oct 20: 185 × 5. Your trend starts with the next session.",
    });
  });

  it("shows ESTIMATED 1RM for the barbell bench, with the goal line", () => {
    const v = buildExerciseView(
      payload({
        history: [
          session("2026-10-23", [set({ weightLb: 190, reps: 5 })]),
          session("2026-10-13", [set({ weightLb: 185, reps: 5 })]),
        ],
      }),
      [{ kind: "lift", sentence: "", exerciseId: BENCH.id, exerciseName: "", targetLb: 205, byDate: null }],
    );
    expect(v.metric).toBe("e1rm");
    if (v.progress.kind !== "chart") throw new Error("expected a chart");
    expect(v.progress.label).toBe("Estimated 1RM");
    expect(v.progress.best).toBe("222 lb");
    expect(v.progress.change).toEqual({ text: "+6 lb", up: true });
    expect(v.progress.span).toBe("over 2 sessions");
    expect(v.progress.reference).toBe(205);
    expect(v.progress.last).toBe("Last top set 190 × 5");
    expect(v.progress.left).toBe("Oct 13");
    expect(v.progress.right).toBe("Oct 23");
  });

  it("shows TOP SET for a preacher curl, and no e1RM or goal line anywhere", () => {
    const v = buildExerciseView(
      payload({
        exercise: CURL,
        history: [
          session("2026-10-20", [set({ weightLb: 50, reps: 10 }), set({ weightLb: 50, reps: 8 })]),
          session("2026-09-03", [set({ weightLb: 45, reps: 10 })]),
        ],
      }),
      [{ kind: "lift", sentence: "", exerciseId: CURL.id, exerciseName: "", targetLb: 70, byDate: null }],
    );
    expect(v.metric).toBe("topSet");
    expect(v.progress).toMatchObject({
      kind: "chart",
      label: "Top set",
      best: "50 × 10",
      change: { text: "+5 lb", up: true },
      span: "since Sep 3",
      values: [45, 50],
      reference: null,
      last: "Last top set 50 × 10",
    });
  });

  it("names the best top set by weight first, with the reps done at it", () => {
    const v = buildExerciseView(payload({
      exercise: CURL,
      history: [
        session("2026-10-23", [set({ weightLb: 45, reps: 15 })]),
        session("2026-10-20", [set({ weightLb: 55, reps: 6 })]),
      ],
    }));
    expect(v.progress).toMatchObject({ kind: "chart", best: "55 × 6", change: { text: "−10 lb", up: false } });
  });

  it("shows BEST SET in reps for a zero-load lift", () => {
    const v = buildExerciseView(payload({
      exercise: PUSHUP,
      history: [
        session("2026-10-23", [set({ weightLb: 0, reps: 14 })]),
        session("2026-10-20", [set({ weightLb: 0, reps: 12 })]),
      ],
    }));
    expect(v.progress).toMatchObject({
      kind: "chart",
      label: "Best set",
      best: "14 reps",
      change: { text: "+2 reps", up: true },
      last: "Last best set 14 reps",
    });
  });

  it("reports no change rather than '+0 lb'", () => {
    const v = buildExerciseView(payload({
      exercise: CURL,
      history: [session("2026-10-23", [set()]), session("2026-10-20", [set()])],
    }));
    expect(v.progress).toMatchObject({ kind: "chart", change: null });
  });

  it("keeps warmups in the history rows but out of volume and set count", () => {
    const v = buildExerciseView(payload({
      history: [session("2026-10-23", [set({ weightLb: 95, isWarmup: true }), set({ weightLb: 185 })])],
    }));
    expect(v.sessions[0].sets).toHaveLength(2);
    expect(v.sessions[0].workingSets).toBe(1);
    expect(v.sessions[0].volumeLb).toBe(185 * 5);
    expect(v.sessions[0].summary).toBe("1 set · 925 lb");
  });

  it("summarises a session in words, with grouped thousands", () => {
    const v = buildExerciseView(payload({
      history: [
        session("2026-10-23", [set(), set(), set(), set({ reps: 5, weightLb: 185 })]),
        session("2026-10-20", [set({ isWarmup: true })]),
        session("2026-10-18", [set({ weightLb: 0, reps: 12 }), set({ weightLb: 0, reps: 10 })]),
      ],
    }));
    expect(v.sessions.map((s) => s.summary)).toEqual([
      "4 sets · 3,700 lb",
      "Warmups only",
      "2 sets",
    ]);
  });

  it("carries the workout id through, and null from an older server", () => {
    const v = buildExerciseView(payload({
      history: [session("2026-10-23", [set()], "w-1"), session("2026-10-20", [set()])],
    }));
    expect(v.sessions.map((s) => s.workoutId)).toEqual(["w-1", null]);
  });

  it("puts the PR flag on the right history row", () => {
    const v = buildExerciseView(payload({
      exercise: CURL,
      history: [session("2026-10-23", [set({ weightLb: 55 })]), session("2026-10-20", [set({ weightLb: 50 })])],
    }));
    expect(v.sessions.map((s) => s.pr)).toEqual([true, false]);
  });
});

/**
 * The cue on the detail screen. These pin the consumption so it cannot quietly
 * fall out again.
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
    expect(buildExerciseView(payload()).cue).toBeNull();
  });

  it("folds an empty string to null rather than drawing an empty block", () => {
    expect(buildExerciseView(payload({ cue: "" })).cue).toBeNull();
  });
});

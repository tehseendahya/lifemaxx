import { describe, it, expect } from "vitest";

import type { CatalogueExercise } from "@/lib/types";
import { deleteWorkoutPrompt } from "../lift/next";
import { editFromSet } from "../lift/logic";
import {
  BLANK_PREFILL, OFFLINE_MESSAGE, ONLY_SET_WARNING, addDraftSet, addPrefill, displaySetFor,
  groupByExercise, removeWarning, screenState, setWritePayload, staleKeys, workingSetCount,
  workoutStats, workoutSubtitle, writeErrorMessage,
} from "./model";
import { clearLiftNotice, liftNotice, postLiftNotice } from "./notice";
import type { WorkoutDetail, WorkoutDetailSet } from "./types";

const BENCH = "bench";
const DIP = "dip";

let n = 0;
const set = (over: Partial<WorkoutDetailSet> = {}): WorkoutDetailSet => {
  n += 1;
  return {
    id: `s${n}`, exerciseId: BENCH, exerciseName: "Barbell Bench Press", setIndex: n,
    reps: 5, weightLb: 185, rpe: null, toFailure: false, isWarmup: false, felt: null, note: "",
    loggedAt: `2026-10-21T08:${String(n).padStart(2, "0")}:00.000Z`, ...over,
  };
};

const detail = (sets: WorkoutDetailSet[], over: Partial<WorkoutDetail> = {}): WorkoutDetail => ({
  id: "w1", name: "Push — Chest & Triceps", nameIsCustom: false, localDate: "2026-10-21",
  startedAt: "2026-10-21T08:00:00.000Z", endedAt: "2026-10-21T08:58:00.000Z", durationMin: 58,
  status: "completed", live: false, sets, ...over,
});

describe("groupByExercise", () => {
  it("groups in first-performed order and labels W / 1 / 2 / F", () => {
    n = 0;
    const d = detail([
      set({ isWarmup: true, weightLb: 135, reps: 8 }),
      set({ rpe: 8 }),
      set({ exerciseId: DIP, exerciseName: "Dip", weightLb: 0, reps: 12 }),
      set({ rpe: 8.5 }),
      set({ reps: 4, toFailure: true }),
    ]);
    const groups = groupByExercise(d);
    expect(groups.map((g) => g.name)).toEqual(["Barbell Bench Press", "Dip"]);

    const bench = groups[0].rows;
    expect(bench.map((r) => r.label)).toEqual(["W", "1", "2", "3"]);
    expect(bench.map((r) => r.figure)).toEqual(["135 × 8", "185 × 5", "185 × 5", "185 × 4"]);
    expect(bench.map((r) => r.rpe)).toEqual([null, "@8", "@8.5", null]);
    expect(bench.map((r) => r.failure)).toEqual([false, false, false, true]);
    expect(bench[0].warmup).toBe(true);
    expect(groups[0].last.id).toBe("s5");
    expect(groups[1].rows[0].figure).toBe("0 × 12");
  });

  it("orders by logged time even when the server list is not", () => {
    n = 0;
    const a = set({ exerciseId: DIP, exerciseName: "Dip" });
    const b = set();
    const groups = groupByExercise(detail([b, a]));
    expect(groups.map((g) => g.exerciseId)).toEqual([DIP, BENCH]);
  });

  it("draws a warmups-only workout as its warmup rows", () => {
    n = 0;
    const groups = groupByExercise(detail([set({ isWarmup: true }), set({ isWarmup: true })]));
    expect(groups[0].rows.map((r) => r.label)).toEqual(["W", "W"]);
  });
});

describe("workoutStats", () => {
  const catalogue = [
    { id: BENCH, name: "Barbell Bench Press", slug: "barbell-bench-press", incrementLb: 5, equipment: "barbell",
      muscles: [{ muscle: "chest", contribution: 1 }, { muscle: "tricep", contribution: 0.5 }, { muscle: "front_delt", contribution: 0.5 }] },
    { id: DIP, name: "Dip", slug: "dip", incrementLb: 5, equipment: "bodyweight",
      muscles: [{ muscle: "tricep", contribution: 1 }] },
  ] as CatalogueExercise[];

  it("counts working sets and volume, and names the top three muscles", () => {
    n = 0;
    const d = detail([
      set({ isWarmup: true, weightLb: 135, reps: 8 }),
      set(), set(), set(),
      set({ exerciseId: DIP, weightLb: 45, reps: 10 }),
    ]);
    expect(workoutStats(d, catalogue)).toEqual({
      sets: 4,
      volumeLb: "3,225",
      duration: "58 min",
      muscles: "Chest 3 · Triceps 2.5 · Front Delts 1.5",
    });
  });

  it("has no muscle line without a catalogue, and no duration without an end", () => {
    n = 0;
    const s = workoutStats(detail([set()], { durationMin: null }), []);
    expect(s.muscles).toBe(null);
    expect(s.duration).toBe(null);
  });
});

describe("workoutSubtitle", () => {
  it("reads the local date without any timezone shift", () => {
    expect(workoutSubtitle(detail([]))).toBe("Wed, Oct 21 · 58 min");
    expect(workoutSubtitle(detail([], { durationMin: null }))).toBe("Wed, Oct 21");
  });
});

describe("the edit sheet", () => {
  it("opens a server set exactly as it is", () => {
    n = 0;
    const s = set({ rpe: 8, toFailure: true });
    const shown = displaySetFor(s);
    expect(shown.id).toBe(s.id);
    expect(shown.key).toBe(s.id);
    expect(shown.queued).toBe(false);
    expect(editFromSet(shown)).toEqual({ weightLb: 185, reps: 5, rpe: 8, kind: "failure" });
  });

  it("prefills + Add set from the last set here, demoting failure to working", () => {
    n = 0;
    expect(addPrefill(set({ weightLb: 185, reps: 4, rpe: 9, toFailure: true }), undefined))
      .toEqual({ weightLb: 185, reps: 4, rpe: 9, kind: "working" });
    expect(addPrefill(set({ isWarmup: true, weightLb: 95 }), undefined).kind).toBe("warmup");
  });

  it("prefills + Add exercise from lastSets, without its RPE, else blank", () => {
    const last = { localDate: "2026-10-14", weightLb: 20, reps: 15, rpe: 9, sets: 3, bestE1rmLb: null };
    expect(addPrefill(null, last)).toEqual({ weightLb: 20, reps: 15, rpe: null, kind: "working" });
    expect(addPrefill(null, undefined)).toEqual(BLANK_PREFILL);
  });

  it("dresses the prefill as a set the sheet seeds from, with a fresh key per open", () => {
    const a = addDraftSet(BENCH, { weightLb: 20, reps: 15, rpe: null, kind: "warmup" }, 1);
    const b = addDraftSet(BENCH, { weightLb: 20, reps: 15, rpe: null, kind: "warmup" }, 2);
    expect(a.id).toBe(null);
    expect(a.key).not.toBe(b.key);
    expect(editFromSet(a)).toEqual({ weightLb: 20, reps: 15, rpe: null, kind: "warmup" });
  });

  it("writes both kind flags, and an id only for a fix", () => {
    const edit = { weightLb: 165, reps: 5, rpe: 8, kind: "failure" as const };
    expect(setWritePayload("w1", BENCH, edit, "s1")).toEqual({
      workoutId: "w1", id: "s1", exerciseId: BENCH, reps: 5, weightLb: 165, rpe: 8,
      isWarmup: false, toFailure: true,
    });
    expect("id" in setWritePayload("w1", BENCH, edit)).toBe(false);
  });

  it("warns only when the set is the workout's last", () => {
    n = 0;
    expect(removeWarning(detail([set()]))).toBe(ONLY_SET_WARNING);
    expect(removeWarning(detail([set(), set({ isWarmup: true })]))).toBe(null);
  });
});

describe("writeErrorMessage", () => {
  it("says no signal for a request that never reached the server", () => {
    const err = Object.assign(new Error("Network request failed"), { status: 0 });
    expect(writeErrorMessage(err, "x")).toBe(OFFLINE_MESSAGE);
  });

  it("passes the server's own reason through", () => {
    const err = Object.assign(new Error("A set must be 1–100 reps at 0–2000 lb."), { status: 400 });
    expect(writeErrorMessage(err, "x")).toBe("A set must be 1–100 reps at 0–2000 lb.");
    expect(writeErrorMessage("??", "fallback")).toBe("fallback");
  });
});

describe("screenState", () => {
  it("loading, missing, error, live, ready", () => {
    expect(screenState({ data: undefined, error: null, isLoading: true })).toEqual({ kind: "loading" });
    expect(screenState({ data: undefined, error: Object.assign(new Error("Unknown workout."), { status: 404 }), isLoading: false }))
      .toEqual({ kind: "missing" });
    expect(screenState({ data: undefined, error: Object.assign(new Error("The request timed out."), { status: 0 }), isLoading: false }))
      .toEqual({ kind: "error", message: "The request timed out." });
    expect(screenState({ data: detail([], { live: true }), error: null, isLoading: false })).toEqual({ kind: "live" });
    const d = detail([]);
    expect(screenState({ data: d, error: null, isLoading: false })).toEqual({ kind: "ready", detail: d });
  });
});

describe("staleKeys and the delete prompt", () => {
  it("invalidates the workout, bootstrap and each lift once", () => {
    expect(staleKeys("w1", [BENCH, BENCH, DIP])).toEqual([
      ["workout", "w1"], ["bootstrap"], ["exercise", BENCH], ["exercise", DIP],
    ]);
  });

  it("counts working sets for the unchanged delete copy", () => {
    n = 0;
    const d = detail([set({ isWarmup: true }), set(), set()]);
    expect(workingSetCount(d)).toBe(2);
    expect(deleteWorkoutPrompt({ workingSets: workingSetCount(d) }))
      .toBe("All 2 sets will be deleted with it. This cannot be undone.");
  });
});

describe("the Lift notice hand-off", () => {
  it("posts, notifies and clears", () => {
    let calls = 0;
    const off = liftNotice.subscribe(() => { calls += 1; });
    postLiftNotice("Workout deleted.");
    expect(liftNotice.get()).toBe("Workout deleted.");
    clearLiftNotice();
    expect(liftNotice.get()).toBe(null);
    clearLiftNotice();
    expect(calls).toBe(2);
    off();
  });
});

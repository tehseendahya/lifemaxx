import { describe, it, expect } from "vitest";
import {
  LIVE_SESSION_MESSAGE, countedSets, editableReason, nextSetPosition,
  parseSetDelete, parseSetWrite, workoutDetail,
} from "./workout-edit";

const W = "22222222-2222-4222-8222-222222222222";
const S = "33333333-3333-4333-8333-333333333333";
const E = "44444444-4444-4444-8444-444444444444";

describe("parseSetWrite", () => {
  it("accepts a new set and an update, keeping only the fields sent", () => {
    expect(parseSetWrite({ workoutId: W, exerciseId: E, reps: 5, weightLb: 185 })).toEqual({
      ok: true, value: { workoutId: W, exerciseId: E, reps: 5, weightLb: 185 },
    });
    expect(parseSetWrite({ workoutId: W, id: S, reps: 5, weightLb: 165, rpe: null, isWarmup: false }))
      .toEqual({ ok: true, value: { workoutId: W, id: S, reps: 5, weightLb: 165, rpe: null, isWarmup: false } });
  });

  it("needs an exercise for a new set but not for an update", () => {
    expect(parseSetWrite({ workoutId: W, reps: 5, weightLb: 185 }).ok).toBe(false);
    expect(parseSetWrite({ workoutId: W, id: S, reps: 5, weightLb: 185 }).ok).toBe(true);
  });

  it("rejects malformed ids", () => {
    expect(parseSetWrite({ workoutId: "nope", exerciseId: E, reps: 5, weightLb: 1 }).ok).toBe(false);
    expect(parseSetWrite({ workoutId: W, id: "nope", reps: 5, weightLb: 1 }).ok).toBe(false);
    expect(parseSetWrite({ workoutId: W, exerciseId: "nope", reps: 5, weightLb: 1 }).ok).toBe(false);
    expect(parseSetWrite(null).ok).toBe(false);
  });

  it("holds the same sanity bound as /api/sets", () => {
    const at = (reps: unknown, weightLb: unknown) =>
      parseSetWrite({ workoutId: W, exerciseId: E, reps, weightLb }).ok;
    expect(at(1, 0)).toBe(true);
    expect(at(100, 2000)).toBe(true);
    expect(at(0, 100)).toBe(false);
    expect(at(101, 100)).toBe(false);
    expect(at(5.5, 100)).toBe(false);
    expect(at(5, -1)).toBe(false);
    expect(at(5, 2001)).toBe(false);
    expect(at("5", 100)).toBe(false);
    expect(parseSetWrite({ workoutId: W, exerciseId: E, reps: 165, weightLb: 165 })).toEqual({
      ok: false, error: "A set must be 1–100 reps at 0–2000 lb.",
    });
  });

  it("checks rpe and flags", () => {
    const base = { workoutId: W, exerciseId: E, reps: 5, weightLb: 100 };
    expect(parseSetWrite({ ...base, rpe: 8.5 }).ok).toBe(true);
    expect(parseSetWrite({ ...base, rpe: 11 }).ok).toBe(false);
    expect(parseSetWrite({ ...base, rpe: 0 }).ok).toBe(false);
    expect(parseSetWrite({ ...base, toFailure: "yes" }).ok).toBe(false);
    expect(parseSetWrite({ ...base, isWarmup: 1 }).ok).toBe(false);
  });
});

describe("parseSetDelete", () => {
  it("needs both ids", () => {
    expect(parseSetDelete({ workoutId: W, id: S })).toEqual({ ok: true, value: { workoutId: W, id: S } });
    expect(parseSetDelete({ workoutId: W }).ok).toBe(false);
    expect(parseSetDelete({ id: S }).ok).toBe(false);
    expect(parseSetDelete(undefined).ok).toBe(false);
  });
});

describe("editableReason", () => {
  it("404s a workout the user-scoped read did not find", () => {
    expect(editableReason(null, null)).toEqual({ status: 404, message: "Unknown workout." });
  });

  it("409s the live session", () => {
    expect(editableReason({ id: W, status: "active" }, W)).toEqual({ status: 409, message: LIVE_SESSION_MESSAGE });
  });

  it("409s anything not completed", () => {
    expect(editableReason({ id: W, status: "abandoned" }, null)?.status).toBe(409);
    expect(editableReason({ id: W, status: "active" }, null)?.status).toBe(409);
  });

  it("allows a completed workout, even while another session runs", () => {
    expect(editableReason({ id: W, status: "completed" }, null)).toBe(null);
    expect(editableReason({ id: W, status: "completed" }, S)).toBe(null);
  });
});

describe("nextSetPosition", () => {
  const start = new Date("2026-10-21T08:00:00Z");

  it("goes one past the highest index and one second past the latest set", () => {
    const pos = nextSetPosition([
      { setIndex: 3, loggedAt: new Date("2026-10-21T08:40:00Z") },
      { setIndex: 7, loggedAt: new Date("2026-10-21T08:30:00Z") },
      { setIndex: 5, loggedAt: new Date("2026-10-21T08:50:00Z") },
    ], start);
    expect(pos.setIndex).toBe(8);
    expect(pos.loggedAt.toISOString()).toBe("2026-10-21T08:50:01.000Z");
  });

  it("starts at the workout's start when it has no sets", () => {
    const pos = nextSetPosition([], start);
    expect(pos.setIndex).toBe(1);
    expect(pos.loggedAt.toISOString()).toBe(start.toISOString());
  });
});

describe("countedSets", () => {
  it("drops rows with no muscle mapping", () => {
    expect(countedSets([
      { isWarmup: false, muscle: "chest", contribution: 1 },
      { isWarmup: true, muscle: null, contribution: null },
    ])).toEqual([{ isWarmup: false, muscles: [{ muscle: "chest", contribution: 1 }] }]);
  });
});

describe("workoutDetail", () => {
  const workout = {
    id: W, name: "Push", nameIsCustom: false, localDate: "2026-10-21",
    startedAt: new Date("2026-10-21T08:00:00Z"), endedAt: new Date("2026-10-21T08:58:00Z"),
    status: "completed",
  };
  const row = (id: string, at: string, weightKg: number) => ({
    id, exerciseId: E, exerciseName: "Bench", setIndex: 1, reps: 5, weightKg,
    rpe: null, toFailure: false, isWarmup: false, felt: null, note: "", loggedAt: new Date(at),
  });

  it("sends lb, ISO strings and logged order", () => {
    const d = workoutDetail(workout, [
      row("b", "2026-10-21T08:20:00Z", 83.91),
      row("a", "2026-10-21T08:10:00Z", 61.235),
    ], null);
    expect(d.durationMin).toBe(58);
    expect(d.live).toBe(false);
    expect(d.endedAt).toBe("2026-10-21T08:58:00.000Z");
    expect(d.sets.map((s) => s.id)).toEqual(["a", "b"]);
    expect(d.sets[0].weightLb).toBe(135);
    expect(d.sets[0].loggedAt).toBe("2026-10-21T08:10:00.000Z");
  });

  it("marks the live session and a missing end", () => {
    const d = workoutDetail({ ...workout, endedAt: null }, [], W);
    expect(d.live).toBe(true);
    expect(d.durationMin).toBe(null);
    expect(d.endedAt).toBe(null);
  });
});

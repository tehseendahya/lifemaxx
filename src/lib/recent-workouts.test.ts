import { describe, it, expect } from "vitest";
import { groupRecentWorkouts, modalSet, type RecentWorkoutRow } from "./recent-workouts";

/**
 * The guard for "it combined all my stuff into one lift".
 *
 * The Lift tab's "Last session" card used to rebuild a session from dates, so
 * two workouts sharing a date became one. The first test is the owner's exact
 * situation; the rest pin the rules that make the list fit to delete from.
 */

const CHEST = "chest-press";
const CURL = "barbell-curl";
const ROW = "barbell-row";
const PUSHDOWN = "triceps-pushdown";

function set(
  workoutId: string, exerciseId: string, at: string,
  over: Partial<RecentWorkoutRow> = {},
): RecentWorkoutRow {
  return {
    workoutId,
    name: workoutId === "w1" ? "Push — Chest & Biceps" : "Pull — Upper Back & Triceps",
    localDate: "2026-10-25",
    startedAt: new Date(workoutId === "w1" ? "2026-10-25T12:23:40Z" : "2026-10-26T00:46:29Z"),
    endedAt: new Date(workoutId === "w1" ? "2026-10-25T13:30:00Z" : "2026-10-26T01:47:08Z"),
    exerciseId,
    reps: 8,
    weightKg: 60,
    rpe: null,
    isWarmup: false,
    loggedAt: new Date(at),
    ...over,
  };
}

describe("two workouts on one date", () => {
  it("stay two workouts — the reported bug", () => {
    // Both rows carry 2026-10-25, exactly as they did in the owner's database.
    // Grouping by date drew them as one session; grouping by workout cannot.
    const rows = [
      set("w1", CHEST, "2026-10-25T12:24:00Z"),
      set("w1", CURL, "2026-10-25T12:40:00Z"),
      set("w2", ROW, "2026-10-26T00:50:00Z"),
      set("w2", PUSHDOWN, "2026-10-26T01:20:00Z"),
    ];

    const out = groupRecentWorkouts(rows);
    expect(out).toHaveLength(2);
    expect(out.map((w) => w.exercises.map((e) => e.exerciseId))).toEqual([
      [ROW, PUSHDOWN],
      [CHEST, CURL],
    ]);
  });

  it("orders newest first by start time, not by the date both share", () => {
    const out = groupRecentWorkouts([
      set("w1", CHEST, "2026-10-25T12:24:00Z"),
      set("w2", ROW, "2026-10-26T00:50:00Z"),
    ]);
    expect(out.map((w) => w.id)).toEqual(["w2", "w1"]);
  });
});

describe("one workout's summary", () => {
  it("lists lifts in the order they were performed", () => {
    const out = groupRecentWorkouts([
      set("w1", CURL, "2026-10-25T12:40:00Z"),
      set("w1", CHEST, "2026-10-25T12:24:00Z"),
      set("w1", CHEST, "2026-10-25T12:28:00Z"),
    ]);
    expect(out[0].exercises.map((e) => e.exerciseId)).toEqual([CHEST, CURL]);
  });

  it("counts working sets only, and leaves out a warmup-only lift", () => {
    const out = groupRecentWorkouts([
      set("w1", CHEST, "2026-10-25T12:24:00Z", { isWarmup: true }),
      set("w1", CHEST, "2026-10-25T12:27:00Z"),
      set("w1", CHEST, "2026-10-25T12:30:00Z"),
      set("w1", CURL, "2026-10-25T12:40:00Z", { isWarmup: true }),
    ]);
    expect(out[0].workingSets).toBe(2);
    expect(out[0].exercises).toHaveLength(1);
    expect(out[0].exercises[0]).toMatchObject({ exerciseId: CHEST, sets: 2 });
  });

  it("still lists a workout that was nothing but warmups", () => {
    // It happened, and it may be exactly the mistake someone came to delete.
    const out = groupRecentWorkouts([
      set("w1", CHEST, "2026-10-25T12:24:00Z", { isWarmup: true }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].workingSets).toBe(0);
    expect(out[0].exercises).toEqual([]);
  });

  it("reports the session's weight × reps as the mode, in whole pounds", () => {
    const out = groupRecentWorkouts([
      set("w1", CHEST, "2026-10-25T12:24:00Z", { weightKg: 83.91, reps: 8 }),
      set("w1", CHEST, "2026-10-25T12:27:00Z", { weightKg: 83.91, reps: 8 }),
      set("w1", CHEST, "2026-10-25T12:30:00Z", { weightKg: 61.23, reps: 10, rpe: 9 }),
    ]);
    expect(out[0].exercises[0]).toMatchObject({ weightLb: 185, reps: 8, sets: 3, rpe: 9 });
  });

  it("works out the duration from start to end", () => {
    const out = groupRecentWorkouts([set("w2", ROW, "2026-10-26T00:50:00Z")]);
    expect(out[0].durationMin).toBe(61);
  });

  it("says nothing about duration when there is no end", () => {
    const out = groupRecentWorkouts([
      set("w1", CHEST, "2026-10-25T12:24:00Z", { endedAt: null }),
    ]);
    expect(out[0].durationMin).toBeNull();
  });
});

describe("modalSet", () => {
  it("prefers the set done most often, then the heavier one", () => {
    expect(modalSet([
      { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }, { weightKg: 60, reps: 10 },
    ])).toEqual({ weightKg: 80, reps: 8 });
    expect(modalSet([{ weightKg: 60, reps: 10 }, { weightKg: 80, reps: 8 }]))
      .toEqual({ weightKg: 80, reps: 8 });
  });
});

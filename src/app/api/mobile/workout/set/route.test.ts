import { describe, it, expect, beforeEach, vi } from "vitest";
import { exercises, sets, workouts } from "@/db/schema";

/**
 * `POST` / `DELETE /api/mobile/workout/set` — editing a workout that is over.
 *
 * The database is a recording stub: every builder call is logged with its
 * table, its values and its WHERE clause, and answered from the state below.
 * `eq`/`and`/`or`/`isNull` are swapped for inspectable objects so a test can
 * assert what a write was scoped by — which is the guard that matters most
 * here: an update scoped by set id alone would edit any set in the database
 * through a workout that merely passed the ownership check.
 */

const USER = "user-1";
const LIVE = "11111111-1111-4111-8111-111111111111";
const DONE = "22222222-2222-4222-8222-222222222222";
const SET = "33333333-3333-4333-8333-333333333333";
const EX = "44444444-4444-4444-8444-444444444444";

interface Call {
  op: "select" | "insert" | "update" | "delete";
  table?: unknown;
  fields?: Record<string, unknown>;
  values?: Record<string, unknown>;
  where?: unknown;
}

let currentUser: string | null = USER;
let liveWorkout: { id: string } | null = null;
let workoutRow: Record<string, unknown> | null = null;
let exerciseVisible = true;
let existingSets: { setIndex: number; loggedAt: Date }[] = [];
let muscleRows: { isWarmup: boolean; muscle: string | null; contribution: number | null }[] = [];
let updatedRows: unknown[] = [];
let deletedSetRows: { id: string }[] = [];
let remainingSets: { id: string }[] = [];
const calls: Call[] = [];

const setRow = (over: Record<string, unknown> = {}) => ({
  id: SET, workoutId: DONE, exerciseId: EX, setIndex: 4, reps: 5, weightKg: 74.84,
  rpe: 8, toFailure: false, isWarmup: false, restS: 120, note: "", felt: null,
  rawText: "", needsParse: false, clientId: null, e1rmKg: null,
  loggedAt: new Date("2026-10-21T08:30:00Z"), ...over,
});

function respond(call: Call): unknown {
  if (call.op === "select") {
    if (call.table === workouts) return workoutRow === null ? [] : [workoutRow];
    if (call.table === exercises) return exerciseVisible ? [{ id: EX }] : [];
    if (call.table === sets) {
      const keys = Object.keys(call.fields ?? {});
      if (keys.includes("muscle")) return muscleRows;
      if (keys.includes("setIndex")) return existingSets;
      return remainingSets;
    }
  }
  if (call.op === "insert") return [setRow({ ...call.values })];
  if (call.op === "update") return call.table === sets ? updatedRows : [];
  if (call.op === "delete") return call.table === sets ? deletedSetRows : [];
  return [];
}

vi.mock("@/lib/supabase/server", () => ({ currentUserId: async () => currentUser }));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...xs: unknown[]) => ({ and: xs }),
  or: (...xs: unknown[]) => ({ or: xs }),
  isNull: (col: unknown) => ({ isNull: col }),
}));

vi.mock("@/db", () => {
  const builder = (call: Call) => {
    calls.push(call);
    const b = {
      from: (t: unknown) => { call.table = t; return b; },
      leftJoin: () => b,
      innerJoin: () => b,
      where: (w: unknown) => { call.where = w; return b; },
      orderBy: () => b,
      limit: () => b,
      values: (v: Record<string, unknown>) => { call.values = v; return b; },
      set: (v: Record<string, unknown>) => { call.values = v; return b; },
      returning: () => b,
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve().then(() => respond(call)).then(res, rej),
    };
    return b;
  };
  return {
    db: {
      select: (fields?: Record<string, unknown>) => builder({ op: "select", fields }),
      insert: (t: unknown) => builder({ op: "insert", table: t }),
      update: (t: unknown) => builder({ op: "update", table: t }),
      delete: (t: unknown) => builder({ op: "delete", table: t }),
    },
    withUser: <T>(_u: string, fn: () => Promise<T>): Promise<T> => fn(),
  };
});

vi.mock("@/lib/queries", () => ({
  getProfile: async () => ({ tz: "Australia/Sydney" }),
  localDate: () => "2026-10-26",
  getActiveWorkout: async () => liveWorkout,
}));

const { POST, DELETE } = await import("./route");

const post = (body: unknown) =>
  POST(new Request("http://t/api/mobile/workout/set", { method: "POST", body: JSON.stringify(body) }));
const del = (body: unknown) =>
  DELETE(new Request("http://t/api/mobile/workout/set", { method: "DELETE", body: JSON.stringify(body) }));

/** Every `eq(col, val)` anywhere in a WHERE tree. */
function eqs(where: unknown): [unknown, unknown][] {
  if (typeof where !== "object" || where === null) return [];
  const w = where as { eq?: [unknown, unknown]; and?: unknown[]; or?: unknown[] };
  if (w.eq) return [w.eq];
  return [...(w.and ?? []), ...(w.or ?? [])].flatMap(eqs);
}
const scopedBy = (where: unknown, col: unknown, val: unknown) =>
  eqs(where).some(([c, v]) => c === col && v === val);

const writes = () => calls.filter((c) => c.op !== "select");
const updatesOf = (table: unknown) => calls.filter((c) => c.op === "update" && c.table === table);
const deletesOf = (table: unknown) => calls.filter((c) => c.op === "delete" && c.table === table);

beforeEach(() => {
  currentUser = USER;
  liveWorkout = null;
  workoutRow = {
    id: DONE, name: "Chest & Triceps", nameIsCustom: false, status: "completed",
    startedAt: new Date("2026-10-21T08:00:00Z"),
  };
  exerciseVisible = true;
  existingSets = [
    { setIndex: 1, loggedAt: new Date("2026-10-21T08:10:00Z") },
    { setIndex: 2, loggedAt: new Date("2026-10-21T08:20:00Z") },
  ];
  muscleRows = [{ isWarmup: false, muscle: "chest", contribution: 1 }];
  updatedRows = [setRow({ reps: 5, weightKg: 74.84 })];
  deletedSetRows = [{ id: SET }];
  remainingSets = [{ id: "other" }];
  calls.length = 0;
});

describe("POST — fixing a set", () => {
  const fix = { workoutId: DONE, id: SET, exerciseId: EX, reps: 5, weightLb: 165, rpe: 8, toFailure: false, isWarmup: false };

  it("updates the figures, scoped by the set AND the workout", async () => {
    const res = await post(fix);
    expect(res.status).toBe(200);

    const [update] = updatesOf(sets);
    expect(scopedBy(update.where, sets.id, SET)).toBe(true);
    expect(scopedBy(update.where, sets.workoutId, DONE)).toBe(true);
    // Only the figures. Position, time, rest and lift are the session's.
    expect(Object.keys(update.values ?? {}).sort()).toEqual(["isWarmup", "reps", "rpe", "toFailure", "weightKg"]);
    expect(update.values?.weightKg).toBeCloseTo(74.84, 2);

    const body = await res.json();
    expect(body.set.weightLb).toBe(165);
    expect(body.workoutName).toBe("Push — Chest");
  });

  it("leaves an omitted rpe or flag alone", async () => {
    await post({ workoutId: DONE, id: SET, reps: 6, weightLb: 165 });
    expect(Object.keys(updatesOf(sets)[0].values ?? {}).sort()).toEqual(["reps", "weightKg"]);
  });

  it("404s a set id that is not in this workout", async () => {
    updatedRows = [];
    const res = await post(fix);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Unknown set.");
    expect(updatesOf(workouts)).toHaveLength(0);
  });
});

describe("POST — adding a set", () => {
  const add = { workoutId: DONE, exerciseId: EX, reps: 15, weightLb: 20 };

  it("inserts after every set already there, with no rest and no client id", async () => {
    const res = await post(add);
    expect(res.status).toBe(200);

    const insert = calls.find((c) => c.op === "insert");
    expect(insert?.table).toBe(sets);
    expect(insert?.values).toMatchObject({
      workoutId: DONE, exerciseId: EX, setIndex: 3, reps: 15,
      rpe: null, toFailure: false, isWarmup: false, restS: null, clientId: null,
    });
    expect((insert?.values?.loggedAt as Date).toISOString()).toBe("2026-10-21T08:20:01.000Z");
  });

  it("refuses an exercise the caller cannot see", async () => {
    exerciseVisible = false;
    const res = await post(add);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown exercise.");
    expect(writes()).toHaveLength(0);
  });

  it("checks the exercise is built-in or the caller's own", async () => {
    await post(add);
    const lookup = calls.find((c) => c.op === "select" && c.table === exercises);
    expect(scopedBy(lookup?.where, exercises.id, EX)).toBe(true);
    expect(scopedBy(lookup?.where, exercises.userId, USER)).toBe(true);
  });
});

describe("POST — the name", () => {
  it("re-derives a derived name and writes it, scoped to the user", async () => {
    muscleRows = [
      { isWarmup: false, muscle: "chest", contribution: 1 },
      { isWarmup: false, muscle: "side_delt", contribution: 1 },
      { isWarmup: false, muscle: "side_delt", contribution: 1 },
    ];
    const res = await post({ workoutId: DONE, exerciseId: EX, reps: 15, weightLb: 20 });
    const body = await res.json();
    const [rename] = updatesOf(workouts);
    expect(rename.values).toEqual({ name: body.workoutName });
    expect(body.workoutName).toBe("Push — Side Delts & Chest");
    expect(scopedBy(rename.where, workouts.id, DONE)).toBe(true);
    expect(scopedBy(rename.where, workouts.userId, USER)).toBe(true);
  });

  it("never touches a name the owner typed", async () => {
    workoutRow = { ...workoutRow, name: "Deload day", nameIsCustom: true };
    const res = await post({ workoutId: DONE, exerciseId: EX, reps: 15, weightLb: 20 });
    expect(res.status).toBe(200);
    expect((await res.json()).workoutName).toBe("Deload day");
    expect(updatesOf(workouts)).toHaveLength(0);
    expect(calls.some((c) => c.op === "select" && Object.keys(c.fields ?? {}).includes("muscle"))).toBe(false);
  });
});

describe("POST — refusals", () => {
  const add = { workoutId: DONE, exerciseId: EX, reps: 5, weightLb: 100 };

  it("404s another user's workout (the scoped read finds nothing)", async () => {
    workoutRow = null;
    const res = await post(add);
    expect(res.status).toBe(404);
    expect(writes()).toHaveLength(0);
  });

  it("scopes the workout read by user", async () => {
    await post(add);
    const read = calls.find((c) => c.op === "select" && c.table === workouts);
    expect(scopedBy(read?.where, workouts.id, DONE)).toBe(true);
    expect(scopedBy(read?.where, workouts.userId, USER)).toBe(true);
  });

  it("409s the live session and writes nothing", async () => {
    liveWorkout = { id: DONE };
    workoutRow = { ...workoutRow, status: "active" };
    const res = await post(add);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("That session is still running. Edit it from Lift.");
    expect(writes()).toHaveLength(0);
  });

  it("409s a workout that is not completed", async () => {
    workoutRow = { ...workoutRow, status: "abandoned" };
    const res = await post(add);
    expect(res.status).toBe(409);
    expect(writes()).toHaveLength(0);
  });

  it("400s a set outside the sanity bound before touching anything", async () => {
    const res = await post({ ...add, reps: 165, weightLb: 165 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("A set must be 1–100 reps at 0–2000 lb.");
    expect(calls).toHaveLength(0);
    expect((await post({ ...add, weightLb: 2001 })).status).toBe(400);
  });

  it("401s when nobody is signed in", async () => {
    currentUser = null;
    expect((await post(add)).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("DELETE — removing a set", () => {
  it("deletes the set, scoped by the set AND the workout, and keeps the workout", async () => {
    const res = await del({ workoutId: DONE, id: SET });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, workoutDeleted: false });

    const [d] = deletesOf(sets);
    expect(scopedBy(d.where, sets.id, SET)).toBe(true);
    expect(scopedBy(d.where, sets.workoutId, DONE)).toBe(true);
    expect(deletesOf(workouts)).toHaveLength(0);
  });

  it("deletes the workout with its last set", async () => {
    remainingSets = [];
    const res = await del({ workoutId: DONE, id: SET });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, workoutDeleted: true });

    const [w] = deletesOf(workouts);
    expect(scopedBy(w.where, workouts.id, DONE)).toBe(true);
    expect(scopedBy(w.where, workouts.userId, USER)).toBe(true);
  });

  it("re-derives the name after a removal that leaves sets", async () => {
    muscleRows = [{ isWarmup: false, muscle: "tricep", contribution: 1 }];
    await del({ workoutId: DONE, id: SET });
    expect(updatesOf(workouts)[0]?.values).toEqual({ name: "Push — Triceps" });
  });

  it("404s a set that is not in this workout", async () => {
    deletedSetRows = [];
    const res = await del({ workoutId: DONE, id: SET });
    expect(res.status).toBe(404);
    expect(deletesOf(workouts)).toHaveLength(0);
  });

  it("refuses the live session, other users' workouts and bad bodies", async () => {
    liveWorkout = { id: DONE };
    expect((await del({ workoutId: DONE, id: SET })).status).toBe(409);
    liveWorkout = null;
    workoutRow = null;
    expect((await del({ workoutId: DONE, id: SET })).status).toBe(404);
    expect((await del({ workoutId: DONE })).status).toBe(400);
    expect(writes()).toHaveLength(0);
  });
});

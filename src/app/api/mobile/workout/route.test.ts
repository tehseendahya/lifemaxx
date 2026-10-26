import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * `DELETE /api/mobile/workout` — the refusals, and that a delete is scoped.
 *
 * The database is stubbed: the cascade from `workouts` to `sets` is a schema
 * fact (`ON DELETE CASCADE` on both foreign keys that point at a workout), and
 * what is under test here is the route's own decisions — which workout it will
 * refuse, and what it answers for one it cannot find.
 */

const USER = "user-1";
const LIVE = "11111111-1111-4111-8111-111111111111";
const DONE = "22222222-2222-4222-8222-222222222222";

let currentUser: string | null = USER;
let liveWorkout: { id: string } | null = null;
let deletedRows: { id: string }[] = [];
const deleteCalls: unknown[] = [];
/** What the user-scoped workout read finds, for GET. */
let workoutRows: Record<string, unknown>[] = [];
let setRows: Record<string, unknown>[] = [];
let lastWhere: unknown = null;

vi.mock("@/lib/supabase/server", () => ({ currentUserId: async () => currentUser }));

// Inspectable WHERE clauses, so GET can be shown to scope its read by user.
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...xs: unknown[]) => ({ and: xs }),
}));

vi.mock("@/db", () => {
  const chain = {
    delete: (table: unknown) => { deleteCalls.push(table); return chain; },
    select: () => chain,
    from: () => chain,
    where: (w: unknown) => { lastWhere = w; return chain; },
    limit: async () => workoutRows,
    returning: async () => deletedRows,
  };
  return { db: chain, withUser: <T>(_u: string, fn: () => Promise<T>): Promise<T> => fn() };
});

vi.mock("@/lib/queries", () => ({
  getProfile: async () => ({ tz: "Australia/Sydney" }),
  localDate: () => "2026-10-26",
  getActiveWorkout: async () => liveWorkout,
  getWorkoutSets: async () => setRows,
}));

const { DELETE, GET } = await import("./route");
const { workouts } = await import("@/db/schema");

const get = (id: string | null) =>
  GET(new Request(`http://t/api/mobile/workout${id === null ? "" : `?id=${id}`}`));

const workoutRow = (over: Record<string, unknown> = {}) => ({
  id: DONE, name: "Push — Chest & Triceps", nameIsCustom: false, localDate: "2026-10-21",
  startedAt: new Date("2026-10-21T08:00:00Z"), endedAt: new Date("2026-10-21T08:58:00Z"),
  status: "completed", ...over,
});

const benchSet = {
  id: "33333333-3333-4333-8333-333333333333", clientId: null,
  exerciseId: "44444444-4444-4444-8444-444444444444", exerciseName: "Barbell Bench Press",
  exerciseSlug: "barbell-bench-press", incrementKg: 2.5, setIndex: 1, reps: 5,
  weightKg: 83.91, rpe: 8, toFailure: false, isWarmup: false, restS: 120,
  note: "paused", felt: "strong", loggedAt: new Date("2026-10-21T08:10:00Z"),
};

describe("reading a workout", () => {
  it("returns every set in lb with the workout's figures", async () => {
    workoutRows = [workoutRow()];
    setRows = [benchSet];
    const res = await get(DONE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: DONE, name: "Push — Chest & Triceps", nameIsCustom: false, localDate: "2026-10-21",
      startedAt: "2026-10-21T08:00:00.000Z", endedAt: "2026-10-21T08:58:00.000Z",
      durationMin: 58, status: "completed", live: false,
      sets: [{
        id: benchSet.id, exerciseId: benchSet.exerciseId, exerciseName: "Barbell Bench Press",
        setIndex: 1, reps: 5, weightLb: 185, rpe: 8, toFailure: false, isWarmup: false,
        felt: "strong", note: "paused", loggedAt: "2026-10-21T08:10:00.000Z",
      }],
    });
  });

  it("scopes the read by user", async () => {
    workoutRows = [workoutRow()];
    setRows = [];
    await get(DONE);
    const clauses = (lastWhere as { and: { eq: [unknown, unknown] }[] }).and.map((c) => c.eq);
    expect(clauses).toContainEqual([workouts.id, DONE]);
    expect(clauses).toContainEqual([workouts.userId, USER]);
  });

  it("says when the workout is the live session", async () => {
    workoutRows = [workoutRow({ status: "active", endedAt: null })];
    setRows = [];
    liveWorkout = { id: DONE };
    const body = await (await get(DONE)).json();
    expect(body.live).toBe(true);
    expect(body.durationMin).toBe(null);
  });

  it("answers 404 for a workout that is not yours or does not exist", async () => {
    workoutRows = [];
    const res = await get(DONE);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Unknown workout.");
  });

  it("rejects a missing or malformed id", async () => {
    expect((await get(null)).status).toBe(400);
    expect((await get("not-a-uuid")).status).toBe(400);
  });
});

const del = (id: string | null) =>
  DELETE(new Request(`http://t/api/mobile/workout${id === null ? "" : `?id=${id}`}`, { method: "DELETE" }));

beforeEach(() => {
  currentUser = USER;
  liveWorkout = null;
  deletedRows = [];
  deleteCalls.length = 0;
});

describe("deleting a workout", () => {
  it("deletes a finished workout", async () => {
    deletedRows = [{ id: DONE }];
    const res = await del(DONE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: DONE });
    expect(deleteCalls).toHaveLength(1);
  });

  it("refuses the session that is still running, and deletes nothing", async () => {
    // Its sets may still be in the outbox. Deleting the row under them would
    // leave every one with nowhere to land.
    liveWorkout = { id: LIVE };
    const res = await del(LIVE);
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toContain("Stop it first");
    expect(deleteCalls).toHaveLength(0);
  });

  it("does not let a running session block deleting a different one", async () => {
    liveWorkout = { id: LIVE };
    deletedRows = [{ id: DONE }];
    expect((await del(DONE)).status).toBe(200);
  });

  it("answers 404 for a workout that is not yours or does not exist", async () => {
    // The delete is scoped to the user; nothing matching is a 404, not a quiet
    // success that leaves the phone believing something was removed.
    deletedRows = [];
    expect((await del(DONE)).status).toBe(404);
  });

  it("rejects a missing or malformed id before touching anything", async () => {
    expect((await del(null)).status).toBe(400);
    expect((await del("not-a-uuid")).status).toBe(400);
    expect(deleteCalls).toHaveLength(0);
  });

  it("401s when nobody is signed in", async () => {
    currentUser = null;
    expect((await del(DONE)).status).toBe(401);
    expect(deleteCalls).toHaveLength(0);
  });
});

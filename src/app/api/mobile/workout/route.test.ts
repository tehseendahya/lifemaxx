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

vi.mock("@/lib/supabase/server", () => ({ currentUserId: async () => currentUser }));

vi.mock("@/db", () => {
  const chain = {
    delete: (table: unknown) => { deleteCalls.push(table); return chain; },
    where: () => chain,
    returning: async () => deletedRows,
  };
  return { db: chain, withUser: <T>(_u: string, fn: () => Promise<T>): Promise<T> => fn() };
});

vi.mock("@/lib/queries", () => ({
  getProfile: async () => ({ tz: "Australia/Sydney" }),
  localDate: () => "2026-10-26",
  getActiveWorkout: async () => liveWorkout,
}));

const { DELETE } = await import("./route");

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

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TdeeResult } from "@/lib/domain/tdee";
import { proposeTargets, proteinTargetG } from "@/lib/domain/tdee";

/**
 * `POST /api/mobile/target` — what it refuses, and that the number it saves is
 * its own.
 *
 * The database is stubbed. What is under test is the route's decisions: a 409
 * before maintenance is measured, a 400 for anything that is not one of the
 * three modes, and a saved kcal that comes from the server's TDEE whatever the
 * client sent alongside the mode.
 */

const USER = "user-1";
const TODAY = "2026-10-26";

const OK: TdeeResult = {
  status: "ok",
  tdee: 2377,
  marginKcal: 11,
  trendKgPerWeek: -0.164,
  currentKg: 82.085,
  meanIntake: 2196,
  weighIns: 13,
};

let currentUser: string | null = USER;
let tdee: TdeeResult = OK;
const calls: { op: string; arg?: unknown }[] = [];
let inserted: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/server", () => ({ currentUserId: async () => currentUser }));

vi.mock("@/db", () => {
  const chain = {
    delete: (table: unknown) => { calls.push({ op: "delete", arg: table }); return chain; },
    insert: (table: unknown) => { calls.push({ op: "insert", arg: table }); return chain; },
    values: (v: Record<string, unknown>) => { inserted = v; return chain; },
    where: () => { calls.push({ op: "where" }); return chain; },
    returning: async () => [{ ...inserted }],
  };
  return { db: chain, withUser: <T>(_u: string, fn: () => Promise<T>): Promise<T> => fn() };
});

// Every function the route and `route()` import from this module.
vi.mock("@/lib/queries", () => ({
  getProfile: async () => ({ tz: "Australia/Sydney" }),
  localDate: () => TODAY,
  getTdee: async () => tdee,
}));

const { POST } = await import("./route");

const post = (body: unknown) =>
  POST(new Request("http://t/api/mobile/target", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));

beforeEach(() => {
  currentUser = USER;
  tdee = OK;
  calls.length = 0;
  inserted = null;
});

describe("setting a target", () => {
  it("saves the server's own number for the mode", async () => {
    const res = await post({ mode: "cut" });
    expect(res.status).toBe(200);

    const expected = proposeTargets(OK.tdee, OK.currentKg).cut;
    expect(inserted).toMatchObject({
      userId: USER,
      effectiveFrom: TODAY,
      mode: "cut",
      kcal: expected,
      proteinG: proteinTargetG(OK.currentKg),
      carbsG: null,
      fatG: null,
      tdeeEstimate: OK.tdee,
    });
    expect((await res.json()).target).toEqual({
      mode: "cut",
      kcal: expected,
      proteinG: proteinTargetG(OK.currentKg),
      effectiveFrom: TODAY,
      tdeeEstimate: OK.tdee,
    });
  });

  it("ignores a kcal the client sends alongside the mode", async () => {
    const res = await post({ mode: "bulk", kcal: 9999 });
    expect(res.status).toBe(200);
    expect(inserted!.kcal).toBe(proposeTargets(OK.tdee, OK.currentKg).bulk);
    expect(inserted!.kcal).not.toBe(9999);
  });

  it("replaces today's row instead of stacking a second one on the same date", async () => {
    await post({ mode: "maintain" });
    expect(calls.map((c) => c.op)).toEqual(["delete", "where", "insert"]);
  });
});

describe("refusals", () => {
  it("409s while maintenance is not measured, and writes nothing", async () => {
    tdee = { status: "insufficient_data", weighIns: 3, needed: 8 };
    const res = await post({ mode: "cut" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      "Maintenance isn't measured yet — 3 of 8 weigh-ins. Targets switch on once it is.",
    );
    expect(calls).toHaveLength(0);
  });

  it("400s for anything that is not one of the three modes", async () => {
    for (const body of [{}, { mode: "calibrating" }, { mode: "CUT" }, { mode: 1 }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("401s when nobody is signed in", async () => {
    currentUser = null;
    expect((await post({ mode: "cut" })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

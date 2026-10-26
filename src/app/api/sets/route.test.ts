import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * `POST /api/sets` — the sanity bound, at the only place every client passes
 * through.
 *
 * This route is where the web SetLogger, the phone's outbox, the confirmation
 * sheet and the voice path all end up. Until the bound was added here it
 * existed on exactly one path: the deterministic parser. Anything that skipped
 * that parser could write a 165-rep set — a model answer, a hand-rolled
 * request, the web logger's own number inputs — which is the reported bug
 * arriving by a different road.
 *
 * One bad row is not cosmetic. Epley on 165 reps at 165 lb yields a ~2000 lb
 * e1RM, which becomes the exercise's all-time peak and rescales its entire
 * trend chart.
 *
 * The database is stubbed: what is under test is the refusal and the status it
 * refuses with, not the insert. `getActiveWorkout` is mocked to a live session
 * so that a rejection cannot be mistaken for "no session started".
 */

let currentUser: string | null = "user-1";

vi.mock("@/lib/supabase/server", () => ({
  currentUserId: async () => currentUser,
}));

vi.mock("@/db", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => [] as unknown[],
    insert: () => chain,
    values: () => chain,
    onConflictDoUpdate: () => chain,
    returning: async () => [{ id: "set-1", setIndex: 1 }],
    update: () => chain,
    set: () => chain,
  };
  return {
    db: chain,
    withUser: <T>(_u: string, fn: () => Promise<T>): Promise<T> => fn(),
  };
});

vi.mock("@/lib/queries", () => ({
  getProfile: async () => ({ tz: "America/New_York" }),
  localDate: () => "2026-10-25",
  getActiveWorkout: async () => ({
    id: "workout-1",
    startedAt: new Date("2026-10-25T18:00:00Z"),
  }),
  // The route resolves a set against the session it was LOGGED in rather than
  // whatever is active on arrival, so this is the lookup it actually calls.
  // Leaving it out of the mock does not fail loudly — vitest answers the call
  // with a 500, which the old `not.toBe(400)` assertions below happily
  // accepted. They assert `toBe(200)` now.
  workoutForSetAt: async () => ({
    id: "workout-1",
    startedAt: new Date("2026-10-25T18:00:00Z"),
  }),
}));

const { POST } = await import("./route");
const { SANITY } = await import("@/lib/llm/shorthand");

function post(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/sets", {
    method: "POST",
    body: JSON.stringify({ exerciseId: "11111111-1111-4111-8111-111111111111", ...body }),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  currentUser = "user-1";
});

describe("the sanity bound", () => {
  it("refuses the reported typo — 165 reps at 165 lb", async () => {
    const res = await POST(post({ reps: 165, weightLb: 165 }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    // The message has to name the range, because the caller is a person who
    // needs to know what to type instead.
    expect(JSON.stringify(body)).toContain(String(SANITY.maxReps));
  });

  it("refuses every shape of implausible set", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["too many reps", { reps: SANITY.maxReps + 1, weightLb: 100 }],
      ["zero reps", { reps: 0, weightLb: 100 }],
      ["negative reps", { reps: -5, weightLb: 100 }],
      ["fractional reps", { reps: 5.5, weightLb: 100 }],
      ["too heavy", { reps: 5, weightLb: SANITY.maxWeightLb + 1 }],
      ["negative weight", { reps: 5, weightLb: -10 }],
      ["NaN reps", { reps: Number.NaN, weightLb: 100 }],
      ["NaN weight", { reps: 5, weightLb: Number.NaN }],
      ["missing reps", { weightLb: 100 }],
    ];
    for (const [label, body] of cases) {
      const res = await POST(post(body));
      expect(res.status, label).toBe(400);
    }
  });

  it("accepts a real set, including the edges", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["an ordinary set", { reps: 5, weightLb: 165 }],
      ["bodyweight", { reps: 12, weightLb: 0 }],
      ["the rep ceiling", { reps: SANITY.maxReps, weightLb: 100 }],
      ["the weight ceiling", { reps: 1, weightLb: SANITY.maxWeightLb }],
      ["one rep", { reps: SANITY.minReps, weightLb: 400 }],
    ];
    for (const [label, body] of cases) {
      const res = await POST(post(body));
      // `toBe(200)`, not `not.toBe(400)`. The weaker form passed on a 500 for
      // a whole round of this file's life: the route gained a dependency the
      // mock did not provide, every one of these crashed, and "not 400" is
      // true of a crash.
      expect(res.status, label).toBe(200);
    }
  });

  it("checks the bound before it checks for a session", async () => {
    // Order matters for the message the user sees: an implausible set with no
    // session open should say what is wrong with the set, not "start a session".
    const res = await POST(post({ reps: 165, weightLb: 165 }));
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("Start a session");
  });

  it("401s before validating anything, when nobody is signed in", async () => {
    currentUser = null;
    const res = await POST(post({ reps: 165, weightLb: 165 }));
    expect(res.status).toBe(401);
  });
});

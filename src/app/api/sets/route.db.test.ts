import "../../../../load-env";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

/**
 * `POST /api/sets` as the phone's fix-a-set sheet uses it — against a real
 * Postgres, because the thing under test is an `ON CONFLICT DO UPDATE` clause
 * and a mocked `db` cannot tell you what it leaves behind.
 *
 * ── WHAT THIS GUARDS ───────────────────────────────────────────────────────
 *
 * The owner asked to be able to fix a set they had typed wrong. There is no
 * PATCH route and deliberately so: this route already upserts on
 * `(workout_id, client_id)` — that is what makes a retry after a lost response
 * land on the row it already wrote — so a correction is a re-POST of the same
 * `clientId`, which means it goes through the outbox and therefore works in the
 * basement the set was logged in.
 *
 * Four properties have to hold for that to be a correction rather than a quiet
 * data loss, and none of them is visible from the route's own source:
 *
 *  1. it UPDATES, never inserts a second row;
 *  2. the set keeps its `set_index` and its `rest_s`, so a fix an hour later
 *     does not renumber the session or record an hour of rest in front of it;
 *  3. a field the body OMITS is left exactly as it was. The phone's session
 *     payload carries the figures a chip draws and not the set note or the raw
 *     text of what was dictated, so without this a weight correction would
 *     send `note: ""` and wipe a sentence the owner typed;
 *  4. a field the body SENDS is written even when it is `null` or `false` —
 *     clearing an RPE and un-marking a failure are both real corrections, and
 *     an "omitted means preserve" rule implemented with a falsy check would
 *     make them impossible.
 *
 * Only `currentUserId` is stubbed. `withUser`, RLS, the unique index and the
 * defaults are all live.
 *
 * Skipped, not failed, without a DATABASE_URL.
 */

const USER = "aaaaaaaa-0000-4000-8000-0000000005e7";

/*
 * The session, and the two sets in it, anchored in the RECENT PAST.
 *
 * `parseLoggedAt` in the route refuses a stamp from the future or from before
 * the session started and silently substitutes `now` — which is correct
 * behaviour (a phone clock a year out would put a set outside every rollup) and
 * fatal to a fixture written with hard-coded wall-clock times. Fixed times
 * passed this suite on the day they were written and then measured a rest gap
 * of zero. Floored to whole seconds so the stamps survive a round trip through
 * a `timestamptz` and back out as an ISO string with `.000`.
 */
const SECOND_MS = 1000;
const START = new Date(Math.floor((Date.now() - 30 * 60_000) / SECOND_MS) * SECOND_MS);
const AT_FIRST = new Date(START.getTime() + 4 * 60_000).toISOString();
const AT_SECOND = new Date(START.getTime() + 7 * 60_000).toISOString();
/** Three minutes between them, which is what `rest_s` has to come out as. */
const REST_S = 180;

let currentUser: string | null = USER;

vi.mock("@/lib/supabase/server", () => ({
  currentUserId: async () => currentUser,
}));

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("correcting a set through the upsert", () => {
  let POST: (req: Request) => Promise<Response>;
  let DELETE: (req: Request) => Promise<Response>;
  let dbm: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let orm: typeof import("drizzle-orm");
  let units: typeof import("@/lib/domain/units");

  let bench: string;
  let squat: string;
  let workout: string;

  beforeAll(async () => {
    ({ POST, DELETE } = await import("./route"));
    dbm = await import("@/db");
    schema = await import("@/db/schema");
    orm = await import("drizzle-orm");
    units = await import("@/lib/domain/units");

    await cleanup();
    await dbm.adminDb.insert(schema.profiles).values({ id: USER, email: "a@sets-route.test" });

    const rows = await dbm.adminDb
      .select({ id: schema.exercises.id, slug: schema.exercises.slug })
      .from(schema.exercises)
      .where(orm.and(
        orm.isNull(schema.exercises.userId),
        orm.inArray(schema.exercises.slug, ["barbell-bench-press", "back-squat"]),
      ));
    bench = rows.find((r) => r.slug === "barbell-bench-press")?.id as string;
    squat = rows.find((r) => r.slug === "back-squat")?.id as string;
    expect(bench).toBeTruthy();
    expect(squat).toBeTruthy();
  });

  afterAll(async () => {
    await cleanup().catch(() => {});
  });

  beforeEach(async () => {
    currentUser = USER;
    await dbm.adminDb.delete(schema.workouts).where(orm.eq(schema.workouts.userId, USER));
    const [row] = await dbm.adminDb.insert(schema.workouts).values({
      userId: USER,
      status: "active",
      localDate: START.toISOString().slice(0, 10),
      startedAt: START,
    }).returning({ id: schema.workouts.id });
    workout = row.id;
  });

  async function cleanup() {
    if (!dbm) return;
    await dbm.adminDb.delete(schema.profiles).where(orm.eq(schema.profiles.id, USER));
  }

  function post(body: Record<string, unknown>): Promise<Response> {
    return POST(new Request("http://t/api/sets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  /** Every row of the session, oldest first, straight from Postgres. */
  async function rowsOf(): Promise<{
    id: string; exerciseId: string; setIndex: number; reps: number; weightKg: number;
    rpe: number | null; toFailure: boolean; isWarmup: boolean;
    felt: string | null; note: string; rawText: string; restS: number | null;
    loggedAt: Date;
  }[]> {
    return dbm.adminDb.select({
      id: schema.sets.id,
      exerciseId: schema.sets.exerciseId,
      setIndex: schema.sets.setIndex,
      reps: schema.sets.reps,
      weightKg: schema.sets.weightKg,
      rpe: schema.sets.rpe,
      toFailure: schema.sets.toFailure,
      isWarmup: schema.sets.isWarmup,
      felt: schema.sets.felt,
      note: schema.sets.note,
      rawText: schema.sets.rawText,
      restS: schema.sets.restS,
      loggedAt: schema.sets.loggedAt,
    }).from(schema.sets)
      .where(orm.eq(schema.sets.workoutId, workout))
      .orderBy(schema.sets.setIndex) as never;
  }

  /** The original write, exactly as the voice path queues one. */
  const ORIGINAL = {
    clientId: "11111111-1111-4111-8111-000000000001",
    reps: 10,
    weightLb: 155,
    rpe: 7,
    toFailure: false,
    isWarmup: false,
    felt: "normal",
    note: "left shoulder pinched",
    rawText: "chest supported row 155 for 10",
    loggedAt: AT_FIRST,
  };

  // ------------------------------------------------------------ the mechanism

  it("updates the row instead of writing a second one", async () => {
    expect((await post({ exerciseId: bench, ...ORIGINAL })).status).toBe(200);

    // `editSetPayload` on the phone: same clientId, same loggedAt, corrected
    // figures, and no `note`/`rawText` because the phone does not know them.
    const fix = await post({
      exerciseId: bench,
      clientId: ORIGINAL.clientId,
      loggedAt: ORIGINAL.loggedAt,
      reps: 10,
      weightLb: 165,
      rpe: 8,
      toFailure: true,
      isWarmup: false,
      felt: "normal",
    });
    expect(fix.status).toBe(200);

    const rows = await rowsOf();
    expect(rows).toHaveLength(1);
    expect(units.kgToLb(rows[0].weightKg)).toBeCloseTo(165, 3);
    expect(rows[0].rpe).toBe(8);
    expect(rows[0].toFailure).toBe(true);
  });

  it("keeps the set's place in the session and the rest measured before it", async () => {
    // Two sets, so the second has a real `rest_s` and a `set_index` of 2.
    await post({ exerciseId: bench, ...ORIGINAL });
    await post({
      exerciseId: bench,
      clientId: "11111111-1111-4111-8111-000000000002",
      reps: 8,
      weightLb: 155,
      loggedAt: AT_SECOND,
    });

    const before = await rowsOf();
    expect(before.map((r) => r.setIndex)).toEqual([1, 2]);
    expect(before[1].restS).toBe(REST_S);

    // Fix the FIRST set. Delete-and-relog — the only way to do this before —
    // would have moved it to set_index 3 and given it a stale rest gap.
    await post({
      exerciseId: bench,
      clientId: ORIGINAL.clientId,
      loggedAt: ORIGINAL.loggedAt,
      reps: 9,
      weightLb: 165,
      rpe: 8,
      toFailure: false,
      isWarmup: false,
      felt: "normal",
    });

    const after = await rowsOf();
    expect(after).toHaveLength(2);
    expect(after[0].setIndex).toBe(1);
    expect(after[0].reps).toBe(9);
    // Untouched by the correction, both of them.
    expect(after[0].restS).toBe(before[0].restS);
    expect(after[1].restS).toBe(REST_S);
    expect(after[1].setIndex).toBe(2);
    expect(after[0].loggedAt.toISOString()).toBe(ORIGINAL.loggedAt);
  });

  // -------------------------------------------------- omitted means preserve

  it("leaves the note and the raw text alone when the body omits them", async () => {
    await post({ exerciseId: bench, ...ORIGINAL });

    await post({
      exerciseId: bench,
      clientId: ORIGINAL.clientId,
      loggedAt: ORIGINAL.loggedAt,
      reps: 10,
      weightLb: 165,
      rpe: 7,
      toFailure: false,
      isWarmup: false,
      felt: "normal",
    });

    const [row] = await rowsOf();
    // The whole reason the rule exists. Before it, a weight correction sent
    // `note: ""` — because the phone has no idea what the note says — and the
    // sentence the owner dictated was gone with no error anywhere.
    expect(row.note).toBe("left shoulder pinched");
    expect(row.rawText).toBe("chest supported row 155 for 10");
    expect(units.kgToLb(row.weightKg)).toBeCloseTo(165, 3);
  });

  it("still lets a caller change the note on purpose", async () => {
    await post({ exerciseId: bench, ...ORIGINAL });
    await post({ exerciseId: bench, ...ORIGINAL, note: "felt fine actually" });

    const [row] = await rowsOf();
    expect(row.note).toBe("felt fine actually");
  });

  it("still lets a caller clear the note on purpose", async () => {
    // `note: ""` is a SENT empty string, not an omission, and must still win.
    // An "omitted means preserve" rule written with a falsy check would make
    // deleting a note impossible, which is the opposite failure.
    await post({ exerciseId: bench, ...ORIGINAL });
    await post({ exerciseId: bench, ...ORIGINAL, note: "" });

    const [row] = await rowsOf();
    expect(row.note).toBe("");
  });

  it("writes a sent null RPE and a sent false flag", async () => {
    await post({ exerciseId: bench, ...ORIGINAL, rpe: 9, toFailure: true, isWarmup: true, felt: "strong" });

    await post({
      exerciseId: bench,
      clientId: ORIGINAL.clientId,
      loggedAt: ORIGINAL.loggedAt,
      reps: 10,
      weightLb: 155,
      rpe: null,
      toFailure: false,
      isWarmup: false,
      felt: null,
    });

    const [row] = await rowsOf();
    // Clearing an RPE and un-marking a failure are both real corrections —
    // the fix sheet offers "—" on the RPE control for exactly this.
    expect(row.rpe).toBeNull();
    expect(row.toFailure).toBe(false);
    expect(row.isWarmup).toBe(false);
    expect(row.felt).toBeNull();
  });

  it("preserves an untouched RPE and the flags when they are omitted too", async () => {
    await post({ exerciseId: bench, ...ORIGINAL, rpe: 9, isWarmup: true });
    await post({
      exerciseId: bench,
      clientId: ORIGINAL.clientId,
      loggedAt: ORIGINAL.loggedAt,
      reps: 10,
      weightLb: 155,
    });

    const [row] = await rowsOf();
    expect(row.rpe).toBe(9);
    expect(row.isWarmup).toBe(true);
  });

  // ------------------------------------------------------- what cannot change

  it("cannot move a set to a different exercise", async () => {
    // Not an oversight: `exercise_id` is outside the conflict clause, so a
    // re-post naming another lift leaves the row where it is. The fix sheet
    // therefore does not offer the exercise — offering it would silently do
    // nothing, which is worse than not offering it.
    await post({ exerciseId: bench, ...ORIGINAL });
    await post({ exerciseId: squat, ...ORIGINAL, weightLb: 165 });

    const rows = await rowsOf();
    expect(rows).toHaveLength(1);
    expect(rows[0].exerciseId).toBe(bench);
  });

  it("refuses an implausible correction, leaving the row as it was", async () => {
    await post({ exerciseId: bench, ...ORIGINAL });

    const res = await post({
      exerciseId: bench,
      clientId: ORIGINAL.clientId,
      loggedAt: ORIGINAL.loggedAt,
      reps: 165,
      weightLb: 165,
    });
    expect(res.status).toBe(400);

    const [row] = await rowsOf();
    expect(row.reps).toBe(10);
    expect(units.kgToLb(row.weightKg)).toBeCloseTo(155, 3);
  });

  it("removes the set the sheet's REMOVE button names", async () => {
    await post({ exerciseId: bench, ...ORIGINAL });
    const [row] = await rowsOf();

    const res = await DELETE(new Request("http://t/api/sets", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: row.id }),
    }));
    expect(res.status).toBe(200);
    expect(await rowsOf()).toHaveLength(0);
  });
});

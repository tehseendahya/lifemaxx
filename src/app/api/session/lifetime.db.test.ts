import "../../../../load-env";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

/**
 * The owner's report, reproduced against a real Postgres and then prevented.
 *
 *   "I lifted yesterday (chest and biceps) and today (triceps and back) but it
 *    for some reason combined all my stuff into one lift as it thinks today is
 *    all one day."
 *
 * The cause was not date arithmetic. `localDate()` has always been a real
 * calendar date in a real timezone. The cause was that a session had no way to
 * end except a tap on STOP: `getActiveWorkout` returned any row left in
 * `status = 'active'` with no time bound at all, so `POST /api/session/start`
 * the next day answered `resumed: true` with yesterday's workout and every set
 * of day two was written into day one's row — inheriting day one's
 * `localDate`.
 *
 * These run the real routes against the real tables, because the thing under
 * test is the interaction between three of them and a `status` column. The
 * pure rule has its own tests in `src/lib/domain/session.test.ts`; what those
 * cannot show is whether the routes actually ask it.
 *
 * Skipped, not failed, without a DATABASE_URL.
 */

const USER = "aaaaaaaa-0000-4000-8000-000000005e55";

let currentUser: string | null = USER;

vi.mock("@/lib/supabase/server", () => ({
  currentUserId: async () => currentUser,
}));

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

const H = 60 * 60 * 1000;

describeDb("a session's lifetime", () => {
  let startPOST: (req: Request) => Promise<Response>;
  let setsPOST: (req: Request) => Promise<Response>;
  let sessionGET: (req: Request) => Promise<Response>;
  let dbm: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let orm: typeof import("drizzle-orm");
  let sessions: typeof import("@/lib/sessions");
  let queries: typeof import("@/lib/queries");

  let bench: string;
  let row: string;

  beforeAll(async () => {
    ({ POST: startPOST } = await import("./start/route"));
    ({ POST: setsPOST } = await import("../sets/route"));
    ({ GET: sessionGET } = await import("../mobile/session/route"));
    dbm = await import("@/db");
    schema = await import("@/db/schema");
    orm = await import("drizzle-orm");
    sessions = await import("@/lib/sessions");
    queries = await import("@/lib/queries");

    await cleanup();
    await dbm.adminDb.insert(schema.profiles).values({ id: USER, email: "a@lifetime.test" });

    const found = await dbm.adminDb
      .select({ id: schema.exercises.id, slug: schema.exercises.slug })
      .from(schema.exercises)
      .where(orm.and(
        orm.isNull(schema.exercises.userId),
        orm.inArray(schema.exercises.slug, ["barbell-bench-press", "barbell-row"]),
      ));
    bench = found.find((e) => e.slug === "barbell-bench-press")?.id as string;
    row = found.find((e) => e.slug === "barbell-row")?.id as string;
    expect(bench).toBeTruthy();
  });

  afterAll(async () => { await cleanup().catch(() => {}); });

  beforeEach(async () => {
    currentUser = USER;
    await dbm.adminDb.delete(schema.workouts).where(orm.eq(schema.workouts.userId, USER));
  });

  async function cleanup() {
    if (!dbm) return;
    await dbm.adminDb.delete(schema.profiles).where(orm.eq(schema.profiles.id, USER));
  }

  /** A workout as it would exist after a session nobody stopped. */
  async function openWorkout(startedAt: Date, localDate: string): Promise<string> {
    const [w] = await dbm.adminDb.insert(schema.workouts).values({
      userId: USER, status: "active", localDate, startedAt,
    }).returning({ id: schema.workouts.id });
    return w.id;
  }

  async function addSet(workoutId: string, exerciseId: string, loggedAt: Date, setIndex: number) {
    await dbm.adminDb.insert(schema.sets).values({
      workoutId, exerciseId, setIndex, reps: 8, weightKg: 60, loggedAt,
    });
  }

  function postSet(body: Record<string, unknown>): Promise<Response> {
    return setsPOST(new Request("http://t/api/sets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  const startSession = () => startPOST(new Request("http://t/api/session/start", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  }));

  async function workoutsOf() {
    return dbm.adminDb.select({
      id: schema.workouts.id, status: schema.workouts.status,
      localDate: schema.workouts.localDate, name: schema.workouts.name,
      startedAt: schema.workouts.startedAt, endedAt: schema.workouts.endedAt,
    }).from(schema.workouts)
      .where(orm.eq(schema.workouts.userId, USER))
      .orderBy(schema.workouts.startedAt);
  }

  // ------------------------------------------------------- the reported bug

  it("does not put today's sets into yesterday's workout", async () => {
    // Yesterday: chest at 1pm, last set 2:15pm, STOP never pressed.
    const yesterday = new Date(Date.now() - 23 * H);
    const first = await openWorkout(yesterday, "2026-10-24");
    await addSet(first, bench, new Date(yesterday.getTime() + 15 * 60_000), 1);

    // Today: open the app and start lifting.
    const res = await startSession();
    expect(res.status).toBe(200);
    const started = await res.json() as { resumed: boolean; workout: { id: string } };

    // THE assertion. This answered `resumed: true` with yesterday's row.
    expect(started.resumed).toBe(false);
    expect(started.workout.id).not.toBe(first);

    await postSet({ exerciseId: row, reps: 10, weightLb: 155 });

    const all = await workoutsOf();
    expect(all).toHaveLength(2);
    // Two days, two workouts, two dates — rather than one of each.
    expect(all[0].localDate).not.toBe(all[1].localDate);
    expect(all[0].id).toBe(first);
  });

  it("closes the walked-away session instead of leaving it open forever", async () => {
    const yesterday = new Date(Date.now() - 23 * H);
    const first = await openWorkout(yesterday, "2026-10-24");
    await addSet(first, bench, new Date(yesterday.getTime() + 15 * 60_000), 1);

    await startSession();

    const [closed] = (await workoutsOf()).filter((w) => w.id === first);
    expect(closed.status).toBe("completed");
    // Named from what it actually hit, the same way STOP names one.
    expect(closed.name).not.toBe("Workout");
    expect(closed.endedAt).not.toBeNull();
  });

  it("records the real duration, not the time until it was noticed", async () => {
    // `ended_at = now` would log this as a 23-hour workout and feed that figure
    // to every duration the app shows for it.
    const yesterday = new Date(Date.now() - 23 * H);
    const first = await openWorkout(yesterday, "2026-10-24");
    const lastSet = new Date(yesterday.getTime() + 75 * 60_000);
    await addSet(first, bench, lastSet, 1);

    await startSession();

    const [closed] = (await workoutsOf()).filter((w) => w.id === first);
    const minutes = Math.round((+closed.endedAt! - +closed.startedAt) / 60_000);
    expect(minutes).toBe(75);
  });

  it("bins a session nobody logged anything in", async () => {
    await openWorkout(new Date(Date.now() - 23 * H), "2026-10-24");
    await startSession();

    const [closed] = await workoutsOf();
    expect(closed.status).toBe("abandoned");
  });

  it("takes the session off the Lift screen once it has gone idle", async () => {
    // Without this the phone resumes it on launch and shows a clock reading
    // 1,380 MIN, which is how the owner got there in the first place.
    const first = await openWorkout(new Date(Date.now() - 23 * H), "2026-10-24");
    await addSet(first, bench, new Date(Date.now() - 22 * H), 1);

    const res = await sessionGET(new Request("http://t/api/mobile/session"));
    const payload = await res.json() as { activeWorkout: unknown };
    expect(payload.activeWorkout).toBeNull();
  });

  // ------------------------------------------- the same day, twice

  it("separates a morning session from an evening one", async () => {
    // The owner's second question, and it needs no new concept: eleven hours
    // apart is eleven hours apart, same date or not.
    const morning = new Date(Date.now() - 11 * H);
    const first = await openWorkout(morning, "2026-10-26");
    await addSet(first, bench, new Date(morning.getTime() + 20 * 60_000), 1);

    const started = await (await startSession()).json() as { resumed: boolean };
    expect(started.resumed).toBe(false);
    expect(await workoutsOf()).toHaveLength(2);
  });

  it("resumes the session you are actually in", async () => {
    // The case resuming was built for — a dead phone at exercise four — has to
    // keep working, or this fix trades one data loss for another.
    const started = new Date(Date.now() - 40 * 60_000);
    const first = await openWorkout(started, "2026-10-26");
    await addSet(first, bench, new Date(Date.now() - 5 * 60_000), 1);

    const again = await (await startSession()).json() as { resumed: boolean; workout: { id: string } };
    expect(again.resumed).toBe(true);
    expect(again.workout.id).toBe(first);
    expect(await workoutsOf()).toHaveLength(1);
  });

  it("keeps one long session in one piece", async () => {
    // Warm-up at 10am, still working at 4pm. An elapsed-time cap would cut
    // this in half; an idle rule does not, because sets kept arriving.
    const start = new Date(Date.now() - 6 * H);
    const first = await openWorkout(start, "2026-10-26");
    for (let i = 0; i < 7; i++) {
      await addSet(first, bench, new Date(start.getTime() + i * H), i + 1);
    }

    const again = await (await startSession()).json() as { resumed: boolean };
    expect(again.resumed).toBe(true);
    expect(await workoutsOf()).toHaveLength(1);
  });

  // --------------------------------- the delivery that waited in a pocket

  it("lands a basement set in the session it was logged in, hours later", async () => {
    /*
     * The regression this fix could easily have introduced, and the reason
     * `POST /api/sets` resolves on the set's own `loggedAt`:
     *
     *   07:00  start, log sets with no signal — they sit in the outbox
     *   18:00  app reopened; START LIFT closes the idle morning session and
     *          opens a new one, and only then does the outbox flush
     *
     * Asked "is a session active", those sets 400, are classified permanent,
     * and are dropped. The morning would be gone.
     */
    const morning = new Date(Date.now() - 11 * H);
    const first = await openWorkout(morning, "2026-10-26");
    const loggedAt = new Date(morning.getTime() + 10 * 60_000);
    await addSet(first, bench, loggedAt, 1);

    // Evening: a new session is opened, closing the morning one.
    await startSession();
    const after = await workoutsOf();
    expect(after).toHaveLength(2);

    // Now the queue finally drains, carrying a set stamped 7:10am.
    const late = await postSet({
      exerciseId: bench,
      reps: 8,
      weightLb: 135,
      clientId: "11111111-1111-4111-8111-00000000beef",
      loggedAt: new Date(loggedAt.getTime() + 60_000).toISOString(),
    });
    expect(late.status).toBe(200);

    const landed = await dbm.adminDb.select({ workoutId: schema.sets.workoutId })
      .from(schema.sets)
      .where(orm.eq(schema.sets.clientId, "11111111-1111-4111-8111-00000000beef"));
    // In the morning's workout, which is closed — closed is not the same as
    // wrong — and NOT in the evening's.
    expect(landed[0]?.workoutId).toBe(first);
  });

  it("still refuses a set with no session anywhere near it", async () => {
    const res = await postSet({ exerciseId: bench, reps: 8, weightLb: 135 });
    // 400 and not 500, which is what a bare `throw` produced here before. The
    // outbox retries a 5xx and stops at the first failure, so one homeless set
    // used to wedge every set queued behind it for eight rounds of backoff.
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("Start a session");
  });

  // ------------------------------------------------------------ the helpers

  it("filters a stale session out of getActiveWorkout without writing", async () => {
    const first = await openWorkout(new Date(Date.now() - 23 * H), "2026-10-24");
    await addSet(first, bench, new Date(Date.now() - 22 * H), 1);

    const active = await dbm.withUser(USER, () => queries.getActiveWorkout(USER));
    expect(active).toBeNull();

    // A read that quietly writes is a read nobody can reason about. The row is
    // still `active` until something on a write path settles it.
    const [untouched] = await workoutsOf();
    expect(untouched.status).toBe("active");
  });

  it("is safe to settle twice", async () => {
    const first = await openWorkout(new Date(Date.now() - 23 * H), "2026-10-24");
    await addSet(first, bench, new Date(Date.now() - 22 * H), 1);

    await dbm.withUser(USER, () => sessions.closeStaleSession(USER));
    const once = await workoutsOf();
    await dbm.withUser(USER, () => sessions.closeStaleSession(USER));
    const twice = await workoutsOf();

    expect(twice).toEqual(once);
  });

  it("leaves a live session alone when asked to settle", async () => {
    const start = new Date(Date.now() - 30 * 60_000);
    const first = await openWorkout(start, "2026-10-26");
    await addSet(first, bench, start, 1);

    await dbm.withUser(USER, () => sessions.closeStaleSession(USER));

    const [still] = await workoutsOf();
    expect(still.status).toBe("active");
    expect(still.endedAt).toBeNull();
  });
});

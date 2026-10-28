import "../../../../../load-env";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

/**
 * `POST /api/mobile/run`, against a real Postgres.
 *
 * The property worth a database is idempotency. Importing the same screenshot
 * twice is not an edge case here — it is what a person does when a save times
 * out in a car park — and the whole defence is a unique index plus a derived
 * external id. A mock cannot tell you whether those two actually line up.
 *
 * Skipped, not failed, without a DATABASE_URL.
 */

const USER = "aaaaaaaa-0000-4000-8000-00000000d00e";

let currentUser: string | null = USER;

vi.mock("@/lib/supabase/server", () => ({
  currentUserId: async () => currentUser,
}));

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("importing a run from a screenshot", () => {
  let POST: (req: Request) => Promise<Response>;
  let DELETE: (req: Request) => Promise<Response>;
  let dbm: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let orm: typeof import("drizzle-orm");

  beforeAll(async () => {
    ({ POST, DELETE } = await import("./route"));
    dbm = await import("@/db");
    schema = await import("@/db/schema");
    orm = await import("drizzle-orm");

    await cleanup();
    await dbm.adminDb.insert(schema.profiles).values({
      id: USER, email: "a@run-import.test", tz: "America/Los_Angeles",
    });
  });

  afterAll(async () => { await cleanup().catch(() => {}); });

  beforeEach(async () => {
    currentUser = USER;
    await dbm.adminDb.delete(schema.activities).where(orm.eq(schema.activities.userId, USER));
  });

  async function cleanup() {
    if (!dbm) return;
    await dbm.adminDb.delete(schema.profiles).where(orm.eq(schema.profiles.id, USER));
  }

  function post(body: Record<string, unknown>): Promise<Response> {
    return POST(new Request("http://t/api/mobile/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  async function rows() {
    return dbm.adminDb.select().from(schema.activities)
      .where(orm.eq(schema.activities.userId, USER))
      .orderBy(schema.activities.startedAt);
  }

  /** A 5k at 7:02am Pacific, as the sheet would send it after confirmation. */
  const RUN = {
    startedAt: "2026-10-27T14:02:00.000Z",
    durationS: 25 * 60,
    distanceM: 5000,
    type: "run",
    title: "Morning Run",
    avgHr: 158,
    kcal: 320,
  };

  it("writes the run", async () => {
    const res = await post(RUN);
    expect(res.status).toBe(200);

    const [row] = await rows();
    expect(row.durationS).toBe(1500);
    expect(row.distanceM).toBe(5000);
    expect(row.type).toBe("run");
    expect(row.name).toBe("Morning Run");
    expect(row.avgHr).toBe(158);
  });

  it("files it under the athlete's own calendar day", async () => {
    // 14:02 UTC is 7:02am in Los Angeles — the 27th, not the 28th. Every
    // rollup in this app counts by this column.
    await post(RUN);
    const [row] = await rows();
    expect(row.localDate).toBe("2026-10-27");
  });

  it("files a late-evening run on the day it was actually run", async () => {
    // 03:30 UTC is 8:30pm the PREVIOUS day in Los Angeles. Storing the UTC
    // date here would move the run to tomorrow and out of the week it belongs
    // to.
    await post({ ...RUN, startedAt: "2026-10-28T03:30:00.000Z" });
    const [row] = await rows();
    expect(row.localDate).toBe("2026-10-27");
  });

  it("claims `manual`, never `strava`", async () => {
    // The run may well have been recorded in Strava, but this row did not come
    // from Strava's API. If the API sync is ever switched on it writes its own
    // row under Strava's own id, and the two have to stay distinguishable.
    await post(RUN);
    const [row] = await rows();
    expect(row.provider).toBe("manual");
    expect(row.externalId).toMatch(/^shot-/);
  });

  // ------------------------------------------------------------ idempotency

  it("updates rather than duplicates when the same screenshot is sent twice", async () => {
    // The ordinary case: a save times out in a car park and the person taps
    // save again.
    await post(RUN);
    await post(RUN);
    expect(await rows()).toHaveLength(1);
  });

  it("survives a correction made on the second attempt", async () => {
    await post(RUN);
    // Same run, distance fixed from 5000 to 5200 in the confirmation sheet.
    await post({ ...RUN, distanceM: 5200, title: "Morning Run" });

    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].distanceM).toBe(5200);
  });

  it("ignores the seconds in the start time", async () => {
    // A screen showing `7:02 AM` gives no seconds, so two readings of one
    // screenshot must not land on different ids.
    await post(RUN);
    await post({ ...RUN, startedAt: "2026-10-27T14:02:47.000Z" });
    expect(await rows()).toHaveLength(1);
  });

  it("keeps two runs that genuinely started at different times", async () => {
    await post(RUN);
    await post({ ...RUN, startedAt: "2026-10-27T23:40:00.000Z", title: "Evening Run" });
    expect(await rows()).toHaveLength(2);
  });

  it("clears a verdict written about figures that have changed", async () => {
    await post(RUN);
    await dbm.adminDb.update(schema.activities)
      .set({ verdict: "Steady 5k, right on your easy pace.", verdictGeneratedAt: new Date() })
      .where(orm.eq(schema.activities.userId, USER));

    await post({ ...RUN, distanceM: 8000 });

    const [row] = await rows();
    // One sentence about 5km is not a sentence about 8km, and the nightly pass
    // regenerates it for nothing.
    expect(row.verdict).toBeNull();
    expect(row.verdictGeneratedAt).toBeNull();
  });

  // --------------------------------------------------------------- refusals

  it("refuses figures that cannot be a run", async () => {
    // Checked here and not only in the analyze route: the sheet lets the
    // numbers be corrected by hand, so what the model read says nothing about
    // what is being written.
    for (const [label, body] of [
      ["a pace read as the duration", { ...RUN, durationS: 8 }],
      ["a dropped decimal point", { ...RUN, distanceM: 1_000_000 }],
      ["no duration at all", { ...RUN, durationS: undefined }],
    ] as [string, Record<string, unknown>][]) {
      const res = await post(body);
      expect(res.status, label).toBe(400);
    }
    expect(await rows()).toHaveLength(0);
  });

  it("refuses a start time that is not a date", async () => {
    for (const startedAt of ["", "yesterday", undefined]) {
      const res = await post({ ...RUN, startedAt });
      expect(res.status, String(startedAt)).toBe(400);
    }
  });

  it("takes a run with no distance", async () => {
    // A treadmill screen often shows only a time. That is a real run, and a
    // guessed distance would be far worse than none.
    const res = await post({ ...RUN, distanceM: null });
    expect(res.status).toBe(200);
    const [row] = await rows();
    expect(row.distanceM).toBeNull();
  });

  // ---------------------------------------------------------------- removal

  it("removes a run this path imported", async () => {
    await post(RUN);
    const [row] = await rows();

    const res = await DELETE(new Request("http://t/api/mobile/run", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: row.id }),
    }));
    expect(res.status).toBe(200);
    expect(await rows()).toHaveLength(0);
  });

  it("will not remove a row the Strava sync owns", async () => {
    // The next pull would write it straight back, so the delete would read as
    // broken. Removing it belongs with disconnecting Strava, not here.
    const [synced] = await dbm.adminDb.insert(schema.activities).values({
      userId: USER, provider: "strava", externalId: "99887766", type: "run",
      startedAt: new Date("2026-10-26T14:00:00Z"), localDate: "2026-10-26",
      durationS: 1800, distanceM: 6000,
    }).returning();

    await DELETE(new Request("http://t/api/mobile/run", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: synced.id }),
    }));

    expect(await rows()).toHaveLength(1);
  });
});

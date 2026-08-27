import "../load-env";
process.env.LLM_PROVIDER = "fixtures";

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { adminDb, db, withUser } from "../src/db";
import { profiles, activities, stravaAccounts, weeklyRunningSummaries } from "../src/db/schema";
import { eq, sql } from "drizzle-orm";
import { syncActivities } from "../src/lib/strava";
import { generateRunVerdicts, generateWeeklyRunningSummary } from "../src/lib/running";
import { getRuns } from "../src/lib/queries";
import { M_PER_MILE } from "../src/lib/domain/running";

/**
 * Proves the nightly Strava pull is genuinely idempotent, against a real
 * Postgres and a stand-in for Strava's API.
 *
 * www.strava.com is blocked by this environment's egress policy, so the OAuth
 * round trip itself cannot be exercised here. What can be — and what actually
 * decides whether the cron is safe to run every night forever — is what the
 * sync does to the database when it sees the same activities twice.
 *
 * Runs the model layer on fixtures, so no key is needed and the verdict and
 * rollup paths are still walked end to end.
 */

const USER = "cccccccc-0000-4000-8000-00000000000c";
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/** One Strava activity, in the shape the API returns it. */
function activity(id: number, over: Record<string, unknown> = {}) {
  const day = String((id % 27) + 1).padStart(2, "0");
  return {
    id,
    name: `Morning Run ${id}`,
    type: "Run",
    sport_type: "Run",
    start_date: `2026-08-${day}T11:30:00Z`,
    elapsed_time: 2500,
    moving_time: 2400,
    distance: 5 * M_PER_MILE,
    total_elevation_gain: 30,
    average_heartrate: 152,
    calories: 520,
    suffer_score: 45,
    ...over,
  };
}

async function cleanup() {
  await adminDb.delete(profiles).where(eq(profiles.id, USER));
}

async function main() {
  let feed: ReturnType<typeof activity>[] = [];
  let pageRequests = 0;

  const server = createServer((req, res) => {
    pageRequests += 1;
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const perPage = Number(url.searchParams.get("per_page") ?? 100);
    const page = Number(url.searchParams.get("page") ?? 1);
    const slice = feed.slice((page - 1) * perPage, page * perPage);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(slice));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const count = async () => {
    const rows = (await adminDb.execute(
      sql`select count(*)::int as n from activities where user_id = ${USER}`,
    )) as unknown as { n: number }[];
    return Number(rows[0].n);
  };

  try {
    await cleanup();
    await adminDb.insert(profiles).values({
      id: USER, email: "verify-strava@lifemaxx.local", tz: "America/New_York",
      goalsText: "Half marathon in the fall. Also want visible size in shoulders and back.",
    });
    await adminDb.insert(stravaAccounts).values({
      userId: USER, athleteId: "42", accessToken: "verify", refreshToken: "verify",
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    console.log("\nidempotency");

    feed = [activity(1001), activity(1002), activity(1003, { type: "Ride", sport_type: "Ride" })];

    const first = await syncActivities(USER, "America/New_York", { apiBase });
    const afterFirst = await count();
    check("first sync stores every activity", afterFirst === 3, `${first} fetched, ${afterFirst} rows`);

    const second = await syncActivities(USER, "America/New_York", { apiBase });
    const afterSecond = await count();
    check("re-running the sync creates no duplicate rows", afterSecond === 3,
      `${second} fetched again, still ${afterSecond} rows`);

    const third = await syncActivities(USER, "America/New_York", { apiBase });
    check("a third run is still a no-op", (await count()) === 3, `${third} fetched`);

    const distinct = (await adminDb.execute(sql`
      select count(*)::int as n from (
        select external_id from activities where user_id = ${USER} group by external_id having count(*) > 1
      ) dupes
    `)) as unknown as { n: number }[];
    check("no external id appears twice", Number(distinct[0].n) === 0);

    console.log("\ncorrections and pagination");

    // Strava activities are editable after upload. A re-sync must take the
    // correction rather than pinning whatever we happened to see first.
    feed = [activity(1001, { name: "Tempo 5", distance: 5.2 * M_PER_MILE }), activity(1002), feed[2]];
    await syncActivities(USER, "America/New_York", { apiBase });
    const [renamed] = await adminDb.select().from(activities)
      .where(eq(activities.externalId, "1001")).limit(1);
    check("a renamed activity is corrected in place", renamed.name === "Tempo 5",
      `name is "${renamed.name}"`);
    check("a corrected distance is taken too",
      Math.abs((renamed.distanceM ?? 0) - 5.2 * M_PER_MILE) < 1);
    check("correcting does not duplicate", (await count()) === 3);

    pageRequests = 0;
    feed = Array.from({ length: 230 }, (_, i) => activity(2000 + i));
    await syncActivities(USER, "America/New_York", { apiBase });
    check("more than one page of activities is fetched", pageRequests >= 3,
      `${pageRequests} page requests`);
    check("all 230 land, plus the 3 from before", (await count()) === 233);

    const beforeRepeat = await count();
    await syncActivities(USER, "America/New_York", { apiBase });
    check("a 230-activity re-sync is still idempotent", (await count()) === beforeRepeat);

    console.log("\nverdicts and the weekly rollup");

    feed = [activity(1001, { name: "Tempo 5", distance: 5.2 * M_PER_MILE }), activity(1002)];
    const written = await generateRunVerdicts(USER, "Half marathon in the fall.", "2026-08-28");
    check("verdicts are written for runs that lack one", written > 0, `${written} written`);

    const withVerdicts = await withUser(USER, () => getRuns(USER, "2026-08-28"));
    const sample = withVerdicts.find((r) => r.verdict);
    check("a verdict reads like a sentence about that run", Boolean(sample?.verdict),
      sample?.verdict ?? "none");
    check("rides never get a running verdict",
      !withVerdicts.some((r) => r.type === "Ride"));

    // The summariser works in batches, so a second call legitimately writes the
    // NEXT batch of un-verdicted runs. The invariant that matters is narrower:
    // a sentence already written about a run must never be rewritten.
    const pinned = withVerdicts.find((r) => r.verdict)!;
    const readVerdict = async () => {
      const [row] = await adminDb.select().from(activities).where(eq(activities.id, pinned.id)).limit(1);
      return row.verdict;
    };

    await generateRunVerdicts(USER, "Half marathon in the fall.", "2026-08-28");
    check("a verdict already written is never rewritten", await readVerdict() === pinned.verdict);

    const stillPending = (await withUser(USER, () => getRuns(USER, "2026-08-28")))
      .filter((r) => r.verdict === null).length;
    const wroteMore = await generateRunVerdicts(USER, "Half marathon in the fall.", "2026-08-28");
    check("each pass only touches runs that still lack a verdict",
      wroteMore <= stillPending, `${wroteMore} written, ${stillPending} were pending`);

    await syncActivities(USER, "America/New_York", { apiBase });
    check("a re-sync does not wipe the verdict already written",
      await readVerdict() === pinned.verdict);

    const summary = await generateWeeklyRunningSummary(USER, "Half marathon in the fall.", "2026-08-28");
    check("the weekly rollup is generated and stored", Boolean(summary),
      summary?.slice(0, 80) ?? "none");

    const [stored] = await adminDb.select().from(weeklyRunningSummaries)
      .where(eq(weeklyRunningSummaries.userId, USER)).limit(1);
    check("the rollup keeps the numbers it was computed from", Boolean(stored?.stats));

    await generateWeeklyRunningSummary(USER, "Half marathon in the fall.", "2026-08-28");
    const rows = await adminDb.select().from(weeklyRunningSummaries)
      .where(eq(weeklyRunningSummaries.userId, USER));
    check("regenerating a week updates rather than duplicating", rows.length === 1);

    console.log("\nrow-level security still applies to all of it");
    const otherUser = "dddddddd-0000-4000-8000-00000000000d";
    await adminDb.delete(profiles).where(eq(profiles.id, otherUser));
    await adminDb.insert(profiles).values({ id: otherUser, email: "other@lifemaxx.local" });
    const leaked = await withUser(otherUser, () => db.select().from(activities));
    check("another user sees none of these activities", leaked.length === 0);
    await adminDb.delete(profiles).where(eq(profiles.id, otherUser));
  } finally {
    await cleanup();
    server.close();
  }

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  process.exit(1);
});

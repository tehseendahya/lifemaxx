import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron";
import { adminDb } from "@/db";
import { stravaAccounts, profiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { syncActivities } from "@/lib/strava";
import { generateRunVerdicts } from "@/lib/running";
import { localDate } from "@/lib/queries";

export const maxDuration = 60;

/**
 * Nightly activity pull, then a verdict on anything new.
 *
 * Idempotent end to end: the sync upserts on (user_id, provider, external_id),
 * and verdicts are only written for runs that do not have one — so a re-run,
 * an overlapping window or a double-fired cron all cost nothing and change
 * nothing.
 *
 * The two halves iterate different sets, deliberately. Syncing is only possible
 * for a connected Strava account, but a run can also arrive through
 * `npm run runs:import` from a Strava account archive — which is the only route
 * in since Strava put API access behind a subscription. Keying the verdict loop
 * on `stravaAccounts` too, as it once did, meant imported runs sat without a
 * verdict forever: the rows were there and nothing was ever going to look at
 * them. Verdicts are a property of having runs, not of how they arrived.
 */
export async function GET(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  // Enumerating accounts is a cross-user step; everything inside is scoped.
  const accounts = await adminDb
    .select({ userId: stravaAccounts.userId, tz: profiles.tz })
    .from(stravaAccounts)
    .innerJoin(profiles, eq(profiles.id, stravaAccounts.userId));

  const synced: { userId: string; synced: number | string }[] = [];
  for (const account of accounts) {
    try {
      synced.push({ userId: account.userId, synced: await syncActivities(account.userId, account.tz) });
    } catch (err) {
      console.error("[cron/strava] sync", err);
      synced.push({ userId: account.userId, synced: "failed" });
    }
  }

  const users = await adminDb.select().from(profiles);
  const verdicts: { userId: string; verdicts: number | string }[] = [];
  for (const user of users) {
    // A failed verdict must not fail the sync — the rows are the durable part,
    // and tomorrow's run picks up anything still missing a sentence.
    try {
      const n = await generateRunVerdicts(user.id, user.goalsText, localDate(user.tz));
      if (n > 0) verdicts.push({ userId: user.id, verdicts: n });
    } catch (err) {
      console.error("[cron/strava] verdicts", err);
      verdicts.push({ userId: user.id, verdicts: "failed" });
    }
  }

  return NextResponse.json({ ok: true, synced, verdicts });
}

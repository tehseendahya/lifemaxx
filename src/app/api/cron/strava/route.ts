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
 */
export async function GET(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  // Enumerating accounts is the one cross-user step; the rest is scoped.
  const accounts = await adminDb
    .select({ userId: stravaAccounts.userId, tz: profiles.tz, goalsText: profiles.goalsText })
    .from(stravaAccounts)
    .innerJoin(profiles, eq(profiles.id, stravaAccounts.userId));

  const results: { userId: string; synced: number | string; verdicts?: number }[] = [];

  for (const account of accounts) {
    try {
      const synced = await syncActivities(account.userId, account.tz);
      const today = localDate(account.tz);

      // A failed verdict must not fail the sync — the rows are the durable
      // part, and tomorrow's run picks up anything still missing a sentence.
      let verdicts = 0;
      try {
        verdicts = await generateRunVerdicts(account.userId, account.goalsText, today);
      } catch (err) {
        console.error("[cron/strava] verdicts", err);
      }

      results.push({ userId: account.userId, synced, verdicts });
    } catch (err) {
      console.error("[cron/strava]", err);
      results.push({ userId: account.userId, synced: "failed" });
    }
  }

  return NextResponse.json({ ok: true, results });
}

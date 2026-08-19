import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron";
import { db } from "@/db";
import { stravaAccounts, profiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { syncActivities } from "@/lib/strava";

export const maxDuration = 60;

/** Nightly activity pull. Idempotent, so a re-run or overlap costs nothing. */
export async function GET(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const accounts = await db
    .select({ userId: stravaAccounts.userId, tz: profiles.tz })
    .from(stravaAccounts)
    .innerJoin(profiles, eq(profiles.id, stravaAccounts.userId));

  const results: { userId: string; synced: number | string }[] = [];
  for (const account of accounts) {
    try {
      results.push({ userId: account.userId, synced: await syncActivities(account.userId, account.tz) });
    } catch (err) {
      console.error("[cron/strava]", err);
      results.push({ userId: account.userId, synced: "failed" });
    }
  }

  return NextResponse.json({ ok: true, results });
}

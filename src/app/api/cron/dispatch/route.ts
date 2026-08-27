import { NextResponse } from "next/server";
import { authorizeCron, weekdayOf } from "@/lib/cron";
import { GET as stravaJob } from "../strava/route";
import { GET as weeklyJob } from "../weekly/route";

export const maxDuration = 60;

/**
 * One cron slot, two jobs.
 *
 * Vercel's Hobby tier allows two cron jobs per project and this app has three
 * (nightly verdict, Sunday review, Strava pull). The nightly verdict keeps its
 * own slot because it is the time-sensitive one — it fires at 9pm local and
 * says something about the day you just had. The other two share this slot.
 *
 * Scheduled at 22:00 UTC, the same hour the Sunday review used to run, so
 * gating that branch on UTC Sunday reproduces `0 22 * * 0` exactly. The Strava
 * pull is the only job whose timing actually changes, and it is idempotent by
 * construction — `strava:verify` proves a re-run writes no duplicate rows —
 * so moving it costs nothing but freshness.
 *
 * Both jobs still have their own routes. This only changes what Vercel calls
 * on a schedule, not what you can trigger by hand.
 */
export async function GET(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const ran: Record<string, unknown> = {};

  // Runs first so the Sunday review sees the week's last activities.
  try {
    ran.strava = await (await stravaJob(req)).json();
  } catch (err) {
    console.error("[cron/dispatch] strava", err);
    ran.strava = { error: String(err) };
  }

  const isSunday = weekdayOf(new Date().toISOString().slice(0, 10)) === 0;
  if (isSunday) {
    // A failed review must not mask the sync result above.
    try {
      ran.weekly = await (await weeklyJob(req)).json();
    } catch (err) {
      console.error("[cron/dispatch] weekly", err);
      ran.weekly = { error: String(err) };
    }
  } else {
    ran.weekly = { skipped: "not Sunday" };
  }

  return NextResponse.json({ ok: true, ran });
}

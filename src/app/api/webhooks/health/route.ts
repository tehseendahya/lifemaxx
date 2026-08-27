import { NextResponse } from "next/server";
import { bearerAuthorized } from "@/lib/bearer";
import { adminDb, db, withUser } from "@/db";
import { profiles, activities, bodyMetrics } from "@/db/schema";
import { eq } from "drizzle-orm";
import { parseHealthPayload } from "@/lib/health-export";
import { localDate } from "@/lib/queries";

export const maxDuration = 60;

/**
 * Where Health Auto Export POSTs Apple Health data.
 *
 * This is what makes run ingestion autonomous without a Strava subscription:
 * Strava's iOS app and an Apple Watch both write workouts into HealthKit, and
 * that app forwards them here on a schedule.
 *
 * Rows land as provider "healthkit" on the same
 * (user_id, provider, external_id) unique index the Strava paths use, keyed by
 * the stable HealthKit workout id. The app's Batch Requests option splits one
 * sync across several POSTs and resends overlapping windows, so the same
 * workout arrives repeatedly by design — every write here has to be an upsert,
 * not an insert.
 *
 * A workout that also came from Strava will exist twice, once per provider.
 * That is deliberate: they are different records of the same run with different
 * ids, and silently merging them on a fuzzy time match would be a guess. Pick
 * one source.
 */
export async function POST(req: Request) {
  const secret = process.env.HEALTH_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "HEALTH_WEBHOOK_SECRET not set" }, { status: 500 });
  }
  if (!bearerAuthorized(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body is not JSON" }, { status: 400 });
  }

  // No session on a webhook. One profile is the normal case for this app; more
  // than one has to say which, rather than writing someone else's health data.
  const header = req.headers.get("x-lifemaxx-user");
  const all = await adminDb.select().from(profiles);
  if (all.length === 0) return NextResponse.json({ error: "No profile exists" }, { status: 404 });

  const user = header
    ? all.find((p) => p.id === header || p.email.toLowerCase() === header.toLowerCase())
    : all.length === 1 ? all[0] : undefined;

  if (!user) {
    return NextResponse.json(
      { error: "Send X-Lifemaxx-User with the user id when more than one profile exists" },
      { status: 400 },
    );
  }

  const report = parseHealthPayload(body);

  await withUser(user.id, async () => {
    for (const w of report.workouts) {
      const row = {
        userId: user.id,
        provider: "healthkit" as const,
        externalId: w.externalId,
        type: w.type,
        name: w.name,
        startedAt: w.startedAt,
        localDate: localDate(user.tz, w.startedAt),
        durationS: w.durationS,
        distanceM: w.distanceM,
        elevationM: w.elevationM,
        avgHr: w.avgHr,
        kcal: w.kcal,
      };
      await db.insert(activities).values(row).onConflictDoUpdate({
        target: [activities.userId, activities.provider, activities.externalId],
        // The verdict stays put, as in every other write to this table: a
        // resend must not wipe the sentence already written about a run.
        set: {
          type: row.type, name: row.name, startedAt: row.startedAt, localDate: row.localDate,
          durationS: row.durationS, distanceM: row.distanceM, elevationM: row.elevationM,
          avgHr: row.avgHr, kcal: row.kcal,
        },
      });
    }

    // Group into days using the athlete's timezone, not UTC — a 7:30am
    // weigh-in in Sydney is 21:30 the previous day in UTC, and filing it there
    // puts every morning reading one day ahead of the meals it is read against.
    const byDay = new Map<string, Record<string, number>>();
    for (const point of report.metricPoints) {
      const day = localDate(user.tz, point.at);
      const row = byDay.get(day) ?? {};
      row[point.field] = point.value;
      byDay.set(day, row);
    }

    for (const [day, values] of byDay) {
      await db.insert(bodyMetrics).values({
        userId: user.id,
        localDate: day,
        weightKg: values.weightKg ?? null,
        bodyFatPct: values.bodyFatPct ?? null,
        steps: values.steps ?? null,
        restingHr: values.restingHr ?? null,
        source: "healthkit",
      }).onConflictDoUpdate({
        target: [bodyMetrics.userId, bodyMetrics.localDate],
        // Only overwrite what this payload actually carried. A push containing
        // steps must not blank out a weight already recorded for that day.
        set: values,
      });
    }
  });

  return NextResponse.json({
    ok: true,
    workouts: report.workouts.length,
    metricPoints: report.metricPoints.length,
    skipped: report.skipped.length,
  });
}

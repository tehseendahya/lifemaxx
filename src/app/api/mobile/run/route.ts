import { route, HttpError } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { db } from "@/db";
import { activities } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { implausibleRun, screenshotExternalId } from "@/lib/domain/run-import";
import { localDate } from "@/lib/queries";

interface Body {
  /** ISO instant. The PHONE resolves this — see the note below. */
  startedAt?: string;
  durationS?: number;
  distanceM?: number | null;
  type?: string;
  title?: string;
  elevationM?: number | null;
  avgHr?: number | null;
  kcal?: number | null;
}

/**
 * Writing a run that came in from a screenshot.
 *
 * ── WHY THE PHONE SENDS THE INSTANT ────────────────────────────────────────
 *
 * The vision pass returns the start time VERBATIM — `"Yesterday at 6:14 PM"`,
 * `"October 27, 2026 at 7:02 AM"` — because resolving that to a moment is not
 * a question about pixels. It is a question about where the athlete is, and
 * only something standing in their timezone can answer it. The phone is; this
 * server is not (it computes `localDate` from a stored profile zone, which is
 * a different and weaker thing). So the phone parses it with its own clock and
 * sends an instant, and this route's only job on the date is to refuse one
 * that is not a date.
 *
 * ── IDEMPOTENT, ON THE INDEX THAT ALREADY EXISTS ───────────────────────────
 *
 * `activities` is unique on `(user_id, provider, external_id)` — the index
 * that makes the nightly Strava pull safe to run forever. This path needs the
 * same property, because the ordinary failure here is a save that times out
 * and a person who taps save again. `screenshotExternalId` derives the id from
 * the start minute, so the second attempt updates the first row instead of
 * giving the week two runs that never happened.
 *
 * `provider` is `manual`, not `strava`. The run may well have been recorded in
 * Strava, but this row did not come from Strava's API and must not claim to:
 * if the API sync is ever switched on it will write its own row under Strava's
 * own activity id, and the two being distinguishable is what lets either be
 * removed without guessing.
 */
export const POST = route<Body>(async ({ userId, tz, body }) => {
  const startedAt = new Date(body.startedAt ?? "");
  if (Number.isNaN(startedAt.getTime())) throw new HttpError("That start time isn’t a date.");

  const durationS = Math.round(Number(body.durationS));
  const distanceM = body.distanceM === null || body.distanceM === undefined
    ? null
    : Number(body.distanceM);

  /*
   * The same bounds the analyze route applied, applied again.
   *
   * Not redundant: this route is reachable without the other one — the phone
   * lets the figures be corrected by hand before saving, which is the entire
   * point of the confirmation step — so the check that ran over the model's
   * reading says nothing about what is actually being written here.
   */
  const impossible = implausibleRun(distanceM, durationS);
  if (impossible !== null) throw new HttpError(impossible);

  const values = {
    userId,
    provider: "manual" as const,
    externalId: screenshotExternalId(startedAt),
    type: (body.type ?? "run").trim().toLowerCase() || "run",
    name: (body.title ?? "").trim(),
    startedAt,
    // The day the run happened in the athlete's own zone, which is what every
    // rollup in this app counts by.
    localDate: localDate(tz, startedAt),
    durationS,
    distanceM,
    elevationM: body.elevationM ?? null,
    avgHr: body.avgHr ?? null,
    kcal: body.kcal ?? null,
  };

  const [row] = await db.insert(activities).values(values)
    .onConflictDoUpdate({
      target: [activities.userId, activities.provider, activities.externalId],
      set: {
        type: values.type,
        name: values.name,
        startedAt: values.startedAt,
        localDate: values.localDate,
        durationS: values.durationS,
        distanceM: values.distanceM,
        elevationM: values.elevationM,
        avgHr: values.avgHr,
        kcal: values.kcal,
        /*
         * Cleared, not kept. The verdict is one sentence the summariser wrote
         * about THESE figures; a correction to the distance makes it a
         * sentence about numbers that are no longer there, and it is cheap to
         * regenerate on the next nightly pass.
         */
        verdict: null,
        verdictGeneratedAt: null,
      },
    })
    .returning();

  return { activity: row };
});

export const DELETE = route<{ id: string }>(async ({ userId, body }) => {
  // Scoped to this provider: a screenshot import can be undone, a row the
  // Strava sync owns cannot be deleted from here — the next pull would write
  // it straight back and the delete would read as broken.
  await db.delete(activities).where(and(
    eq(activities.id, body.id),
    eq(activities.userId, userId),
    eq(activities.provider, "manual"),
  ));
  return { ok: true };
});

export const OPTIONS = preflight;

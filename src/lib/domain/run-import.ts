import { M_PER_MILE, paceSecPerMile } from "./running";

/**
 * Turning a screenshot of a run into a row.
 *
 * ── WHY THIS PATH EXISTS AT ALL ────────────────────────────────────────────
 *
 * Runs reach this app three ways and every one of them has a cost. The Strava
 * API needs a paid Strava subscription to create an application; the Apple
 * Health relay needs a paid tier of a third-party app; the account archive is
 * free but is a zip file you unpack on a laptop. None of those is "I just
 * finished a run and want it in the app".
 *
 * So: screenshot the run, hand it to a vision model, confirm four numbers,
 * done. It costs one model call and works from the phone in the car park.
 *
 * ── WHAT THIS MODULE IS FOR, AND WHAT IT IS NOT ────────────────────────────
 *
 * The model reads pixels; everything that decides whether the result is
 * BELIEVABLE lives here, in plain functions with tests. That split is the same
 * one the set parser uses, and for the same reason: a model's confidence is
 * its own opinion of itself, and the only numbers worth trusting are the ones
 * that survive arithmetic.
 *
 * The one error this is really guarding against is the unit. Every run screen
 * in the world prints a bare number next to a unit the model has to read off
 * the image, and miles taken for kilometres is a 61% error on every distance,
 * every pace and every weekly total that follows from it — silently, and
 * forever. It is the same hazard the Strava CSV importer calls out when it
 * picks the larger of two Distance columns, and the Apple Health path when it
 * refuses a quantity whose unit it does not recognise. Three ingestion routes,
 * one bug, three guards.
 */

/** Distances a running app will print. Anything else is not understood. */
export type DistanceUnit = "mi" | "km" | "m";

const METRES_PER: Record<DistanceUnit, number> = {
  mi: M_PER_MILE,
  km: 1000,
  m: 1,
};

export function isDistanceUnit(unit: unknown): unit is DistanceUnit {
  return unit === "mi" || unit === "km" || unit === "m";
}

/**
 * Distance to metres, or `null` when the unit was not understood.
 *
 * `null` rather than a default, and that is the whole point of the function. A
 * fallback to either miles or kilometres would be a coin flip applied silently
 * to the only number on the screen that matters, and the wrong side of it is a
 * 61% error that nothing downstream can detect. Storage is metres; what the
 * screen said is the only thing that decides the conversion.
 */
export function distanceToMetres(value: number, unit: unknown): number | null {
  if (!isDistanceUnit(unit)) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value * METRES_PER[unit];
}

/**
 * A duration printed as `H:MM:SS`, `MM:SS`, or `SS`, in seconds.
 *
 * Running apps print both forms and which one you get depends on how long you
 * were out, so a parser that assumed either would be wrong for half of all
 * runs. Returns `null` for anything it cannot read, including the negative and
 * malformed cases, rather than guessing a partial reading.
 */
export function durationToSeconds(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+(:\d{1,2}){0,2}$/.test(text)) return null;

  const parts = text.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;

  // Only the leading field may exceed 59: `1:75:00` is not a time anyone shows.
  if (parts.slice(1).some((n) => n > 59)) return null;

  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds > 0 ? seconds : null;
}

/**
 * The bounds a real run sits inside.
 *
 * Deliberately wide. This is not trying to judge whether someone had a good
 * run — it is catching a misread: a decimal point dropped from `6.2` to `62`,
 * a pace read as a duration, a distance read in the wrong unit entirely. The
 * world record for 24 hours is a bit over 200 miles, so 300 cannot be a thing
 * anyone screenshotted, and a 15-second activity is not one either.
 */
export const RUN_BOUNDS = {
  minDurationS: 30,
  maxDurationS: 36 * 60 * 60,
  minDistanceM: 50,
  maxDistanceM: 300 * M_PER_MILE,
} as const;

/** Why this reading cannot be a run, in the user's terms, or `null`. */
export function implausibleRun(distanceM: number | null, durationS: number): string | null {
  if (!Number.isFinite(durationS) || durationS < RUN_BOUNDS.minDurationS) {
    return "That duration is too short to be a run.";
  }
  if (durationS > RUN_BOUNDS.maxDurationS) {
    return "That duration is longer than a day and a half.";
  }
  if (distanceM === null) return null;

  if (distanceM < RUN_BOUNDS.minDistanceM) return "That distance is too short to be a run.";
  if (distanceM > RUN_BOUNDS.maxDistanceM) return "That distance is further than anyone has run.";
  return null;
}

/**
 * The printed pace, normalised to seconds per mile.
 *
 * Pace carries its OWN unit, and it is not always the distance's. A screen set
 * to kilometres prints `7:47 /km`; one set to miles prints `12:31 /mi`. Those
 * are the same pace. Comparing a per-kilometre figure against a per-mile one
 * without converting would make every correctly-read kilometre screenshot look
 * like a 61% error — the check would fire on exactly the readings it is meant
 * to pass, which is worse than not having it.
 *
 * Returns `null` for a unit it cannot use, including `m`: no app prints a pace
 * per metre, so reading one means the fields were misaligned.
 */
export function printedPaceToSecPerMile(raw: string, unit: unknown): number | null {
  const seconds = durationToSeconds(raw);
  if (seconds === null || !isDistanceUnit(unit) || unit === "m") return null;
  return unit === "km" ? seconds * (M_PER_MILE / 1000) : seconds;
}

/**
 * How far the distance and the duration are from agreeing with the pace the
 * screen printed, as a fraction.
 *
 * This is the check that actually catches a misread unit, and it is worth
 * explaining why it works. A running app prints three numbers that are not
 * independent: pace IS distance over duration. So if the model reads `6.21`
 * from a screen that said kilometres while reading `8:02 /mi` correctly, the
 * pace implied by the numbers it extracted comes out 61% away from the pace it
 * also read — and nothing else about the reading looks wrong. One number
 * checking another is the only evidence available inside a single screenshot.
 *
 * `null` when the screen printed no pace, which is not a failure: plenty of
 * summaries show only distance and time, and those are the two this needs.
 */
export function paceDisagreement(
  distanceM: number | null,
  durationS: number,
  printedPaceSecPerMile: number | null,
): number | null {
  if (distanceM === null || printedPaceSecPerMile === null) return null;
  if (!Number.isFinite(printedPaceSecPerMile) || printedPaceSecPerMile <= 0) return null;

  const implied = paceSecPerMile(distanceM, durationS);
  if (implied === null) return null;

  return Math.abs(implied - printedPaceSecPerMile) / printedPaceSecPerMile;
}

/**
 * How far off the printed pace is tolerated before the reading is doubted.
 *
 * Four percent, which is about twenty seconds on an eight-minute mile. Rounding
 * alone explains a few seconds — a screen showing `3.1 mi` has already thrown
 * away up to 16 metres, and `8:02 /mi` up to half a second — and moving-versus-
 * elapsed time explains a few more. A unit confusion is 61% off and a dropped
 * decimal point is 900%, so there is an enormous gap between the noise this has
 * to tolerate and the errors it has to catch. It does not need to be tight.
 */
export const PACE_DISAGREEMENT_LIMIT = 0.04;

export interface RunReading {
  distanceM: number | null;
  durationS: number;
  printedPaceSecPerMile: number | null;
}

/**
 * Whether the numbers read off the screen agree with each other.
 *
 * Returns the reason to show the user, or `null` when everything checks out.
 * A disagreement does NOT discard the reading — the confirmation sheet shows
 * the figures and says they do not add up, because the person holding the
 * phone can see the screenshot and the app cannot.
 */
export function readingDisagrees(reading: RunReading): string | null {
  const off = paceDisagreement(
    reading.distanceM, reading.durationS, reading.printedPaceSecPerMile,
  );
  if (off === null || off <= PACE_DISAGREEMENT_LIMIT) return null;
  return "The distance and time don’t match the pace on the screenshot. Check the distance and its units.";
}

/**
 * The id a screenshot-imported run is stored under.
 *
 * `activities` is unique on `(user_id, provider, external_id)` — that index is
 * what makes the nightly Strava pull idempotent — and this path needs the same
 * property for the same reason: importing the same screenshot twice, which is
 * exactly what happens when a save fails and the user tries again, must update
 * one row rather than write two.
 *
 * Derived from the start time to the minute. Two different runs cannot begin in
 * the same minute, and two readings of one screenshot cannot disagree about
 * which minute it began in — the time is printed on the image. Seconds are
 * dropped deliberately: a screen that shows `7:02 AM` gives no seconds, so
 * including them would make a second import of the same picture land on a
 * different id.
 */
export function screenshotExternalId(startedAt: Date): string {
  return `shot-${startedAt.toISOString().slice(0, 16)}`;
}

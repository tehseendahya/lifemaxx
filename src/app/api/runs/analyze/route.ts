import { route, HttpError } from "@/lib/api";
import { getLlm, JSON_SCHEMAS, runScreenshotSchema } from "@/lib/llm";
import { MODELS } from "@/lib/models";
import { runScreenshotMessages } from "@/lib/llm/prompts";
import {
  distanceToMetres,
  durationToSeconds,
  implausibleRun,
  printedPaceToSecPerMile,
  readingDisagrees,
} from "@/lib/domain/run-import";
import { paceSecPerMile } from "@/lib/domain/running";

interface Body {
  /** data: URI. Never written to disk — held in memory for this call only. */
  imageDataUrl?: string;
}

/**
 * Reading a run off a screenshot.
 *
 * The free way in. A Strava API application needs a paid Strava subscription,
 * the Apple Health relay needs a paid tier of a third-party app, and the
 * account archive is a zip you unpack on a laptop — none of which is "I just
 * finished a run and want it in the app". This is: screenshot it, confirm four
 * numbers, done.
 *
 * ── THE MODEL READS; THIS DECIDES ──────────────────────────────────────────
 *
 * Everything the model returns is a claim about pixels. Everything that turns
 * those claims into figures — the unit conversion, the clock, the plausibility
 * bounds, and the check of the numbers against each other — is a tested pure
 * function in `domain/run-import.ts`, computed here rather than on the phone so
 * the web app and any future caller get the same answers.
 *
 * Nothing is written. This returns a reading for a person to confirm, and the
 * confirmed values go to `POST /api/mobile/run`. A screenshot that was silently
 * trusted would put a wrong distance into the weekly mileage, the pace trend
 * and the coach's context at once.
 *
 * ── THE IMAGE IS NOT PERSISTED ─────────────────────────────────────────────
 *
 * Same rule as meal photos, and for the same reason: there is no bucket, no
 * row and no log line holding it. It arrives in the request body, goes to the
 * model, and dies with this request.
 */
export const POST = route<Body>(async ({ body }) => {
  const imageDataUrl = body.imageDataUrl?.trim();
  if (!imageDataUrl) throw new HttpError("Send a screenshot.");

  const shot = await getLlm().structured({
    model: MODELS.runScreenshot,
    messages: runScreenshotMessages(imageDataUrl),
    schemaName: "run_screenshot",
    jsonSchema: JSON_SCHEMAS.run_screenshot,
    validator: runScreenshotSchema,
  });

  if (!shot.readable) {
    return {
      readable: false as const,
      note: shot.note || "That doesn’t look like a recorded activity.",
    };
  }

  const durationS = durationToSeconds(shot.duration_text);
  if (durationS === null) {
    return {
      readable: false as const,
      note: shot.duration_text
        ? `Couldn’t read the time on that screenshot (“${shot.duration_text}”).`
        : "Couldn’t find a time on that screenshot.",
    };
  }

  /*
   * `null` when the unit was not on screen, and that is the whole point — see
   * `distanceToMetres`. A run with no distance is still loggable (a treadmill
   * screen often shows only time), so this is not fatal; a GUESSED distance
   * would be, because nothing downstream could ever detect it.
   */
  const distanceM = shot.distance === null
    ? null
    : distanceToMetres(shot.distance, shot.distance_unit);

  const impossible = implausibleRun(distanceM, durationS);
  if (impossible !== null) return { readable: false as const, note: impossible };

  const printedPace = shot.pace_text === null
    ? null
    : printedPaceToSecPerMile(shot.pace_text, shot.pace_unit);

  return {
    readable: true as const,
    type: shot.activity_type.trim().toLowerCase() || "run",
    title: shot.title.trim(),
    durationS,
    distanceM,
    /** What the figures imply, which is what will be stored and charted. */
    paceSecPerMile: paceSecPerMile(distanceM, durationS),
    /** What the screen said, for the sheet to show beside it. */
    printedPaceSecPerMile: printedPace,
    /**
     * Set when the distance and time do not agree with the printed pace. The
     * reading is still returned: the person is holding the screenshot and can
     * see what the app cannot.
     */
    warning: readingDisagrees({ distanceM, durationS, printedPaceSecPerMile: printedPace }),
    /** Verbatim. Only something in the athlete's own timezone can read it. */
    startedAtText: shot.started_at_text,
    elevationM: shot.elevation_ft === null ? null : shot.elevation_ft * 0.3048,
    avgHr: shot.avg_hr,
    kcal: shot.kcal === null ? null : Math.round(shot.kcal),
    note: shot.note.trim(),
  };
}, { scope: "manual" });

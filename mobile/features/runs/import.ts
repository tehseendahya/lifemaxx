/**
 * Turning a screenshot of a run into something that can be confirmed and saved.
 *
 * ── WHY THE DATE IS PARSED HERE AND NOT ON THE SERVER ──────────────────────
 *
 * The vision pass returns the start time VERBATIM — `"Yesterday at 6:14 PM"`,
 * `"October 27, 2026 at 7:02 AM"` — and stops there, deliberately. Resolving
 * that to a moment is not a question about pixels; it is a question about
 * where the athlete is standing. "Yesterday" is relative to a clock, and "7:02
 * AM" is a wall time in a zone.
 *
 * This device IS in that zone. `new Date(y, m, d, h, min)` builds the instant
 * in the device's own local time with no timezone arithmetic at all, which is
 * both simpler and more trustworthy than the server doing it from a profile
 * column it was only recently taught to populate.
 *
 * ── WHAT HAPPENS WHEN IT CANNOT BE READ ────────────────────────────────────
 *
 * `null`, and the sheet says it assumed today. Not an error, and not a silent
 * default: a screenshot cropped to the figures alone is a perfectly ordinary
 * thing to send, and the date being wrong matters enough — it decides which
 * day and which WEEK the run counts for — that the person has to see what was
 * assumed rather than discover it in the mileage later.
 */

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** Any clock-shaped text at all. Distinguishes "no time" from "bad time". */
const HAS_CLOCK = /\d{1,2}:\d{2}/;

/** `7:02 AM`, `19:14`, `6:14 p.m.` — the clock part, or `null`. */
function readTime(text: string): { hours: number; minutes: number } | null {
  const match = /(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/i.exec(text)
    ?? /\b(\d{1,2}):(\d{2})\b/.exec(text);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return null;

  const meridiem = match[3]?.toLowerCase();
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    // 12am is 00, 12pm is 12 — the one case a naive `+12` gets wrong twice.
    hours = hours % 12 + (meridiem === "p" ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }

  return { hours, minutes };
}

/** The month name or abbreviation, as an index, or `null`. */
function readMonth(text: string): number | null {
  const lower = text.toLowerCase();
  for (const [index, name] of MONTHS.entries()) {
    // Abbreviations are the first three letters of the full name in every
    // case, including "sept" — matching the prefix covers both forms.
    if (new RegExp(`\\b${name.slice(0, 3)}[a-z]*\\b`).test(lower)) {
      const matched = new RegExp(`\\b(${name.slice(0, 3)}[a-z]*)\\b`).exec(lower)?.[1] ?? "";
      if (name.startsWith(matched)) return index;
    }
  }
  return null;
}

/**
 * The start time a screenshot claims, as an instant on this device's clock.
 *
 * `now` is a parameter so "today" and "yesterday" are testable rather than
 * whatever the machine running the tests happens to think.
 */
export function parseStartedAt(raw: string | null | undefined, now: Date = new Date()): Date | null {
  const text = (raw ?? "").trim();
  if (text === "") return null;

  const time = readTime(text);
  /*
   * A clock that is on the screen but could not be read is a refusal, not a
   * fallback to midnight.
   *
   * The two cases have to be told apart: `"October 27, 2026"` carries no time
   * and midnight is the right answer for it, while `"Today at 13:30 PM"` is
   * garbled and filing it at midnight would move the run to the wrong part of
   * the day with nothing on screen saying so. That is the same silent-shift
   * failure the invalid-date check below exists to prevent.
   */
  if (time === null && HAS_CLOCK.test(text)) return null;

  const lower = text.toLowerCase();

  const relative = /\byesterday\b/.test(lower) ? -1 : /\btoday\b/.test(lower) ? 0 : null;
  if (relative !== null) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + relative);
    return withTime(day, time);
  }

  const month = readMonth(text);
  if (month !== null) {
    // The day is a 1-2 digit number that is not the year and not part of the
    // clock. Stripping the time first is what keeps `7:02` out of the running.
    const withoutTime = text.replace(/\d{1,2}:\d{2}(\s*[ap]\.?m\.?)?/gi, " ");
    const day = Number(/\b(\d{1,2})\b/.exec(withoutTime)?.[1] ?? NaN);
    if (!Number.isFinite(day) || day < 1 || day > 31) return null;

    const year = Number(/\b(20\d{2})\b/.exec(withoutTime)?.[1] ?? now.getFullYear());
    const date = new Date(year, month, day);
    // A month and day that do not exist roll over in the Date constructor —
    // 31 February becomes 3 March — and a silently shifted date is worse than
    // admitting the screenshot could not be read.
    if (date.getMonth() !== month || date.getDate() !== day) return null;
    return withTime(date, time);
  }

  // A bare clock with no date at all. Common on a cropped screenshot, and
  // "today" is the only reading that is ever right for one.
  if (time !== null) {
    return withTime(new Date(now.getFullYear(), now.getMonth(), now.getDate()), time);
  }

  return null;
}

/** Midnight on `day`, moved to the clock time, in this device's own zone. */
function withTime(day: Date, time: { hours: number; minutes: number } | null): Date {
  return new Date(
    day.getFullYear(), day.getMonth(), day.getDate(),
    time?.hours ?? 0, time?.minutes ?? 0, 0, 0,
  );
}

/**
 * The start time to save, and whether it was read or assumed.
 *
 * Falling back to `now` rather than refusing: a run that happened is worth
 * more in the app with a possibly-wrong time than not in it at all, and the
 * sheet shows the figure either way. `assumed` is what the sheet needs in
 * order to say so out loud.
 */
export function resolveStart(
  raw: string | null | undefined,
  now: Date = new Date(),
): { startedAt: Date; assumed: boolean } {
  const parsed = parseStartedAt(raw, now);
  return parsed === null ? { startedAt: now, assumed: true } : { startedAt: parsed, assumed: false };
}

// ------------------------------------------------------- the confirmation

import { formatPace, miles, paceSecPerMile } from "@/lib/shared/running";
import { implausibleRun } from "@/lib/shared/run-import";
import type { ReadShot, SaveRunInput } from "./requests";

/**
 * What the person is being asked to confirm, in the units they read in.
 *
 * Distance is shown in MILES because that is what every other distance in this
 * app shows, even when the screenshot was in kilometres — the figure stored is
 * metres either way, so this is a display choice and not a conversion that can
 * be lost. The screenshot is still on their phone if they want to check it.
 */
export interface RunDraft {
  type: string;
  title: string;
  startedAt: Date;
  /** True when no date could be read and today was assumed. */
  startAssumed: boolean;
  durationS: number;
  distanceM: number | null;
  elevationM: number | null;
  avgHr: number | null;
  kcal: number | null;
  /** The model's own doubt about its reading, carried through to the sheet. */
  warning: string | null;
  note: string;
}

export function draftFromShot(shot: ReadShot, now: Date = new Date()): RunDraft {
  const { startedAt, assumed } = resolveStart(shot.startedAtText, now);
  return {
    type: shot.type,
    title: shot.title,
    startedAt,
    startAssumed: assumed,
    durationS: shot.durationS,
    distanceM: shot.distanceM,
    elevationM: shot.elevationM,
    avgHr: shot.avgHr,
    kcal: shot.kcal,
    warning: shot.warning,
    note: shot.note,
  };
}

/** `48:20`, or `1:02:30` once it runs past an hour. */
export function formatDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours > 0 ? `${hours}:` : ""}${mm}:${String(seconds).padStart(2, "0")}`;
}

/** `3.11 mi`, or `—` when the screen showed no distance. */
export function formatDistance(distanceM: number | null): string {
  if (distanceM === null) return "—";
  return `${(Math.round(miles(distanceM) * 100) / 100).toFixed(2)} mi`;
}

/** The three figures the sheet puts in front of the person, in order. */
export function draftStats(draft: RunDraft): { label: string; value: string }[] {
  return [
    { label: "Distance", value: formatDistance(draft.distanceM) },
    { label: "Time", value: formatDuration(draft.durationS) },
    { label: "Pace", value: formatPace(paceSecPerMile(draft.distanceM, draft.durationS)) },
  ];
}

/**
 * `Tue 27 Oct, 7:02 AM` — the one figure most worth checking.
 *
 * Built from the device's own locale rather than hand-formatted, because this
 * is the line the person is being asked to verify and it should read the way
 * every other date on their phone does.
 */
export function formatStart(at: Date): string {
  try {
    return at.toLocaleString(undefined, {
      weekday: "short", day: "numeric", month: "short",
      hour: "numeric", minute: "2-digit",
    });
  } catch {
    return at.toISOString().slice(0, 16).replace("T", " ");
  }
}

/** Why this draft cannot be saved yet, or `null`. */
export function draftBlocked(draft: RunDraft): string | null {
  return implausibleRun(draft.distanceM, draft.durationS);
}

/** The body `POST /api/mobile/run` expects. */
export function savePayload(draft: RunDraft): SaveRunInput {
  return {
    startedAt: draft.startedAt.toISOString(),
    durationS: draft.durationS,
    distanceM: draft.distanceM,
    type: draft.type,
    title: draft.title,
    elevationM: draft.elevationM,
    avgHr: draft.avgHr,
    kcal: draft.kcal,
  };
}

/*
 * The imports below are relative rather than `@/lib/...` for the same reason
 * the other features' pure modules are: `mobile/vitest.config.ts` runs in a
 * plain node environment with no path alias configured, and the entire value of
 * keeping this file free of `react-native` imports is that it can be unit
 * tested. A module that needs build configuration before it can be tested does
 * not get tested.
 */
import { newClientId } from "../../lib/shared/outbox";
import type { ParseResponse, ParsedEntry, SetWrite } from "../../lib/types";

/**
 * Free-text set logging: everything that is a decision rather than a view.
 *
 * The user's own framing for this flow was blunt: "the most important thing is
 * just the ability to free type the updates and ensure they are parsed into the
 * correct fields". So the parse result is never written straight through. It
 * becomes a list of rows the user can see and correct, one row per SET rather
 * than one per exercise, and nothing reaches the outbox until they confirm.
 *
 * One row per set, not per entry, is the decision this file exists to make
 * possible. "3 sets of 6" heard or typed as 2 must be fixable by tapping `⧉`
 * once — not by retyping the sentence. The cost is that a correction to the
 * exercise has to fan out across the rows that came from the same entry, which
 * is what `entryKey` and `refileEntry` are for.
 *
 * Nothing here is allowed to guess. A row whose exercise did not resolve keeps
 * its sets and blocks the confirm button; it is never dropped and never filed
 * against a near-miss, because a set logged against the wrong exercise is
 * invisible in the UI and wrong forever in the trend chart.
 */

export interface LogRow {
  /** Stable and unique within the list. Duplicating a row mints a new one. */
  key: string;
  /**
   * Which parsed entry this row came from. Re-filing the exercise applies to
   * every row of the entry, because they were all one phrase.
   */
  entryKey: string;
  /** The exercise wording exactly as typed or spoken, before resolution. */
  query: string;
  exerciseId: string | null;
  exerciseName: string | null;
  /** `null` when nothing resolved. `"fuzzy"` is always shown to the user. */
  confidence: "exact" | "fuzzy" | null;
  weightLb: number;
  reps: number;
  rpe: number | null;
  toFailure: boolean;
  isWarmup: boolean;
}

/** The fields a row's own controls can change. The exercise is re-filed per entry. */
export type RowPatch = Partial<Pick<LogRow, "weightLb" | "reps" | "rpe" | "toFailure" | "isWarmup">>;

export type PadField = "weight" | "reps" | "rpe";

// --------------------------------------------------------------- building

/**
 * One row per set, in the order the parser produced them.
 *
 * `ParseResponse.unresolved` is deliberately not read: it is derived from the
 * same entries (it is the list of queries whose `exercise` came back null), and
 * consulting both would make it possible for the two to disagree about whether
 * a row is loggable. The rows are the single source of truth from here on.
 */
export function rowsFromParse(parsed: Pick<ParseResponse, "entries">): LogRow[] {
  const rows: LogRow[] = [];

  parsed.entries.forEach((entry: ParsedEntry, e) => {
    const entryKey = `e${e}`;
    entry.sets.forEach((set, s) => {
      rows.push({
        key: `${entryKey}-s${s}`,
        entryKey,
        query: entry.query,
        exerciseId: entry.exercise?.id ?? null,
        exerciseName: entry.exercise?.name ?? null,
        confidence: entry.exercise?.confidence ?? null,
        weightLb: set.weight_lb,
        reps: set.reps,
        rpe: set.rpe,
        toFailure: set.to_failure,
        isWarmup: set.is_warmup,
      });
    });
  });

  return rows;
}

/** A row for the "couldn't parse that" path, where the user logs it by hand. */
export function blankRow(exercise?: { id: string; name: string } | null): LogRow {
  return {
    key: "manual-0",
    entryKey: "manual",
    query: "",
    exerciseId: exercise?.id ?? null,
    exerciseName: exercise?.name ?? null,
    // The user picked it, or the session screen knows which exercise is under
    // the thumb. Either way it is not a fuzzy match and must not be marked as
    // one — a `~` chip on a row the user chose themselves reads as a bug.
    confidence: exercise ? "exact" : null,
    weightLb: 0,
    reps: 0,
    rpe: null,
    toFailure: false,
    isWarmup: false,
  };
}

// --------------------------------------------------------------- mutations

export function patchRow(rows: LogRow[], key: string, patch: RowPatch): LogRow[] {
  return rows.map((row) => (row.key === key ? { ...row, ...patch } : row));
}

/**
 * Adds a set, immediately after the one it was copied from.
 *
 * Appending to the end instead would reorder the session when a middle entry
 * gains a set, and `POST /api/sets` assigns `set_index` from arrival order — so
 * the list's order here is the order the sets are recorded in.
 */
export function duplicateRow(rows: LogRow[], key: string): LogRow[] {
  const at = rows.findIndex((row) => row.key === key);
  if (at === -1) return rows;

  const copy = { ...rows[at], key: uniqueKey(rows, rows[at].key) };
  return [...rows.slice(0, at + 1), copy, ...rows.slice(at + 1)];
}

export function deleteRow(rows: LogRow[], key: string): LogRow[] {
  return rows.filter((row) => row.key !== key);
}

/**
 * The correction path: every row of one entry moves to the chosen exercise.
 *
 * `query` is left untouched on purpose. It is what the user actually said, it
 * is what `POST /api/mobile/exercise/alias` has to learn, and it is what the
 * row shows under a fuzzy chip. Overwriting it with the canonical name would
 * make the correction unrepeatable and lose the evidence of what went wrong.
 */
export function refileEntry(
  rows: LogRow[],
  entryKey: string,
  exercise: { id: string; name: string },
): LogRow[] {
  return rows.map((row) =>
    row.entryKey === entryKey
      ? { ...row, exerciseId: exercise.id, exerciseName: exercise.name, confidence: "exact" as const }
      : row);
}

/**
 * The wording to teach the server after a correction, or `null` if there is
 * nothing worth teaching.
 *
 * An empty query (the by-hand path) has nothing to learn, and an alias that is
 * already the canonical name is a row the server would store and never use.
 */
export function aliasToLearn(
  rows: LogRow[],
  entryKey: string,
  exercise: { id: string; name: string },
): { exerciseId: string; alias: string } | null {
  const query = rows.find((row) => row.entryKey === entryKey)?.query.trim() ?? "";
  if (query === "") return null;
  if (query.toLowerCase() === exercise.name.toLowerCase()) return null;
  // The server caps aliases at 80 characters and 400s above it; a long
  // mis-transcription is not worth a failed request in the middle of a confirm.
  if (query.length > 80) return null;
  return { exerciseId: exercise.id, alias: query };
}

// ---------------------------------------------------------------- readout

/** Every row must have a real exercise before anything is written. */
export function canConfirm(rows: LogRow[]): boolean {
  return rows.length > 0 && rows.every(isLoggable);
}

/** Reps of zero is the by-hand starting state, not a set. */
function isLoggable(row: LogRow): boolean {
  return row.exerciseId !== null && row.reps >= 1;
}

export function confirmLabel(rows: LogRow[]): string {
  const n = rows.length;
  if (n === 0) return "NOTHING TO LOG";
  return `LOG ${n} SET${n === 1 ? "" : "S"}`;
}

/**
 * Why the confirm button is disabled, in the user's terms.
 *
 * A greyed-out button with no explanation is the worst version of this: the one
 * thing the user cannot do is the one thing they came here for, and the reason
 * is a `null` three layers down.
 */
export function blockedReason(rows: LogRow[]): string | null {
  if (rows.length === 0) return null;

  const unmatched = unmatchedQueries(rows);
  if (unmatched.length > 0) {
    return `Pick an exercise for ${unmatched.map((q) => `“${q}”`).join(" and ")}.`;
  }
  if (rows.some((row) => row.reps < 1)) return "Every set needs a rep count.";
  return null;
}

/** Distinct raw queries that did not resolve, in first-seen order. */
export function unmatchedQueries(rows: LogRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    if (row.exerciseId !== null) continue;
    const label = row.query.trim();
    if (label === "" || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

// ---------------------------------------------------------------- payloads

/**
 * One outbox item per row, each with its own client id.
 *
 * `rawText` carries the whole original input on every row rather than a slice
 * of it. `sets.raw_text` exists so a mangled parse can be revisited later, and
 * a quarter of a sentence is not enough to reconstruct what was meant — the
 * column is cheap and the context is not recoverable once it is gone.
 *
 * The id factory is a parameter so tests are deterministic. In the app it is
 * always `newClientId`, whose output is the outbox item id and therefore the
 * `client_id` that `POST /api/sets` upserts on: a retry after a lost response
 * lands on the row it already wrote instead of writing a second one.
 */
export function payloadsFor(
  rows: LogRow[],
  rawText: string,
  mintId: () => string = newClientId,
): SetWrite[] {
  return rows.map((row) => ({
    clientId: mintId(),
    // Guarded by `canConfirm`; the cast documents that rather than hiding it.
    exerciseId: row.exerciseId as string,
    reps: row.reps,
    weightLb: row.weightLb,
    rpe: row.rpe,
    toFailure: row.toFailure,
    isWarmup: row.isWarmup,
    felt: null,
    note: "",
    rawText,
  }));
}

// ----------------------------------------------------------- number entry

/** The NumberPad's raw digit string for a field's current value. */
export function fieldToPad(row: LogRow, field: PadField): string {
  const value = field === "weight" ? row.weightLb : field === "reps" ? row.reps : row.rpe;
  // `""` is the pad's "untouched" state and shows a muted zero. A real zero —
  // bodyweight dips at bw — is a typed "0" and must look different.
  if (value === null) return "";
  return String(value);
}

/**
 * The pad's string back into the row, clamped to what the column accepts.
 *
 * The clamps are not cosmetic. `reps` is a positive integer and `rpe` is
 * `numeric(3,1)` between 1 and 10 in `parsedSetsSchema` and in the database; an
 * out-of-range value is a 500 from `POST /api/sets` an hour later, in the car
 * park, when the outbox finally drains.
 */
export function padToPatch(field: PadField, raw: string): RowPatch {
  if (field === "rpe") {
    if (raw === "") return { rpe: null };
    const n = Number(raw);
    if (!Number.isFinite(n)) return { rpe: null };
    return { rpe: clamp(n, 1, 10) };
  }

  const n = raw === "" ? 0 : Number(raw);
  if (!Number.isFinite(n)) return {};

  if (field === "reps") return { reps: Math.max(0, Math.round(n)) };
  // Weight keeps one decimal: kg entry converts to things like 220.5, and the
  // plate maths downstream is in lb.
  return { weightLb: Math.max(0, Math.round(n * 10) / 10) };
}

export const PAD_META: Record<PadField, { label: string; unit: string; allowDecimal: boolean }> = {
  weight: { label: "WEIGHT", unit: "lb", allowDecimal: true },
  reps: { label: "REPS", unit: "reps", allowDecimal: false },
  rpe: { label: "RPE", unit: "", allowDecimal: false },
};

// ----------------------------------------------------------------- format

/** `185`, `227.5`, `0` — never `185.0`, and never a float's tail. */
export function fmtWeight(lb: number): string {
  return Number.isInteger(lb) ? String(lb) : (Math.round(lb * 10) / 10).toFixed(1);
}

/** The chip under a row, and whether to show what was heard beneath it. */
export function exerciseChip(row: LogRow): { text: string; tone: "ok" | "fuzzy" | "bad" } {
  if (row.exerciseId === null) {
    return { text: `UNMATCHED: “${row.query}”`, tone: "bad" };
  }
  if (row.confidence === "fuzzy") {
    return { text: `~ ${row.exerciseName}`, tone: "fuzzy" };
  }
  return { text: row.exerciseName ?? "", tone: "ok" };
}

/**
 * Whether to print `heard: "..."` under the chip.
 *
 * Only for a fuzzy match, and only when the wording actually differs. A wrong
 * trigram match is the one failure mode that corrupts history quietly — it
 * looks like a successful log — so the evidence is always on screen for it. On
 * an exact alias match there is nothing to doubt and the extra line is noise.
 */
export function heardLine(row: LogRow): string | null {
  if (row.confidence !== "fuzzy") return null;
  const query = row.query.trim();
  if (query === "" || query.toLowerCase() === (row.exerciseName ?? "").toLowerCase()) return null;
  return `heard: “${query}”`;
}

// --------------------------------------------------------------- recording

/**
 * Hard cap on one recording.
 *
 * Fifteen seconds is far more than "3 sets of 6 at 45" needs and is short
 * enough that a phone left recording in a pocket cannot upload a minute of
 * gym noise. At 24 kbps mono AAC it is about 45 KB.
 */
export const MAX_RECORD_MS = 15_000;

/** The countdown appears only at the end, where it is information rather than pressure. */
export const COUNTDOWN_MS = 5_000;

/** `0:04`. Tabular numerals are the caller's job. */
export function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The seconds left, in the last few only. `null` the rest of the time. */
export function countdownLabel(ms: number): string | null {
  const left = MAX_RECORD_MS - ms;
  if (left > COUNTDOWN_MS) return null;
  return `${Math.max(0, Math.ceil(left / 1000))}s`;
}

/**
 * How many level bars to light, from `RecorderState.metering`.
 *
 * Metering is dBFS: 0 is clipping, and anything below about -45 is a quiet room
 * rather than a voice. The floor is deliberately that high — a meter that
 * twitches on room noise proves nothing, and the only job this has is to be
 * honest about whether the microphone is actually hearing the user. An
 * `undefined` reading (the first poll, or metering disabled) lights nothing
 * rather than guessing.
 */
export function meterLevel(metering: number | undefined, bars: number): number {
  if (metering === undefined || !Number.isFinite(metering)) return 0;
  const FLOOR_DB = -45;
  const CEIL_DB = -5;
  const scaled = (metering - FLOOR_DB) / (CEIL_DB - FLOOR_DB);
  return Math.max(0, Math.min(bars, Math.round(scaled * bars)));
}

// ----------------------------------------------------------------- helpers

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n * 10) / 10));
}

function uniqueKey(rows: LogRow[], base: string): string {
  const taken = new Set(rows.map((row) => row.key));
  for (let n = 2; ; n += 1) {
    const candidate = `${base}·${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

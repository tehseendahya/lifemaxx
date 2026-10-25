/*
 * The imports below are relative rather than `@/lib/...` for the same reason
 * the other features' pure modules are: `mobile/vitest.config.ts` runs in a
 * plain node environment with no path alias configured, and the entire value of
 * keeping this file free of `react-native` imports is that it can be unit
 * tested. A module that needs build configuration before it can be tested does
 * not get tested.
 */
import { classifyStatus, newClientId } from "../../lib/shared/outbox";
import type { ParseResponse, SetWrite } from "../../lib/types";

/**
 * Free-text set logging: everything that is a decision rather than a view.
 *
 * The user's own framing for this flow was blunt: "the most important thing is
 * just the ability to free type the updates and ensure they are parsed into the
 * correct fields". So the parse result is never written straight through. It
 * becomes a list of rows the user can see and correct, and nothing reaches the
 * outbox until they confirm.
 *
 * ── TWO UNITS, NOT ONE ─────────────────────────────────────────────────────
 *
 * The STATE is one row per SET. "3 sets of 6" heard or typed as 2 must be
 * fixable by tapping `⊕` once — not by retyping the sentence — and that needs a
 * list of sets, not a list of exercises. The cost is that a correction to the
 * exercise has to fan out across the rows that came from the same entry, which
 * is what `entryKey` and `refileEntry` are for.
 *
 * The VIEW is one group per ENTRY. The owner's five-line paste produced fifteen
 * rows, and fifteen bordered cards — most of them identical — is not a thing
 * anyone can check before tapping confirm. `groupRows()` is a projection over
 * the same list: it adds no state, so every mutation below stays row-shaped and
 * `payloadsFor` is unchanged.
 *
 * Nothing here is allowed to guess. A row whose exercise did not resolve keeps
 * its sets and blocks the confirm button; it is never dropped and never filed
 * against a near-miss, because a set logged against the wrong exercise is
 * invisible in the UI and wrong forever in the trend chart.
 */

/**
 * How the exercise on an entry was arrived at.
 *
 * `"new"` is the state this round added, and it is a third thing rather than a
 * flavour of the other two: the server created the exercise during the parse,
 * so the row will log fine (unlike `"none"`) but it was never matched to
 * anything (unlike `"exact"`). A lift that did not exist before this paste is a
 * permanent addition to the owner's catalogue and they have to be able to see
 * it before confirming — and then not be nagged about it, because zero taps for
 * a genuinely new lift was the instruction.
 */
export type MatchState = "exact" | "fuzzy" | "new" | "none";

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
  /**
   * `"barbell"`, `"smith"`, `"cable"` — shown in the group header.
   *
   * This is the direct fix for "incline smith vs incline barbell": the two
   * names differ by one word in the middle, and a wrong-machine match is
   * otherwise something the owner has to read twice to catch. `null` when
   * nothing resolved or the server sent no equipment.
   */
  equipment: string | null;
  match: MatchState;
  /**
   * A catalogue exercise the server thought this might have been, when it
   * created a new one anyway. Answering it is one tap either way; see §3.
   */
  nearMiss: { id: string; name: string } | null;
  /**
   * Chunks of the typed line the parser recognised but refused to believe
   * (`"165"` reps, a four-digit weight). Carried so the loss is visible in the
   * sheet instead of silent — the owner's `165,5` typo is exactly this case.
   *
   * Entry-level, duplicated onto every row of the entry the same way `query`
   * is, because the view groups by entry and the state is row-shaped.
   */
  dropped: string[];
  weightLb: number;
  reps: number;
  rpe: number | null;
  toFailure: boolean;
  isWarmup: boolean;
  /** Per-set note. Goes to `sets.note`; `""` means none. */
  note: string;
}

/** The fields a row's own controls can change. The exercise is re-filed per entry. */
export type RowPatch = Partial<
  Pick<LogRow, "weightLb" | "reps" | "rpe" | "toFailure" | "isWarmup" | "note">
>;

/**
 * The fields that still open the `NumberPad`.
 *
 * RPE used to be one of these and is not any more. It has six legal answers and
 * the pad costs three taps (open, digit, DONE) for a value that is one tap on a
 * visible target, so it is a `<Segmented>` on the line instead. Weight and reps
 * keep the pad: they are unbounded and a six-key row of them is not a control.
 */
export type PadField = "weight" | "reps";

/** One exercise's worth of the sheet — a view over `LogRow[]`, never state. */
export interface SetGroup {
  /** The parsed entry this came from. The handle for every bulk action. */
  entryKey: string;
  /** Raw wording, verbatim. The evidence a fuzzy match needs. */
  query: string;
  exerciseId: string | null;
  exerciseName: string | null;
  equipment: string | null;
  match: MatchState;
  nearMiss: { id: string; name: string } | null;
  dropped: string[];
  /** In order; still one `LogRow` per SET. */
  rows: LogRow[];
}

// --------------------------------------------------------------- the wire

/*
 * There is no local wire type here any more.
 *
 * This file used to re-declare `ParsedEntry` with three fields widened —
 * `confidence: "new"`, an entry-level `nearMiss`, and the parser's `dropped` —
 * because `lib/types.ts` declared none of them and nothing on the server sent
 * them. Both halves landed in the same round: `parseSetsText` now creates
 * unknown exercises and sends all three, and `lib/types.ts` declares all three.
 * Two descriptions of one payload is exactly how a client and a server drift,
 * so the duplicate is gone and `ParsedEntry` is read directly.
 *
 * `nearMiss` and `dropped` stay OPTIONAL in that declaration, and that is the
 * property worth keeping: this sheet still renders correctly against a server
 * that sends neither. An absent `nearMiss` is no question rather than a crash,
 * and an absent `confidence: "new"` reads as `"exact"` — which is how the
 * sheet behaved before any of this existed.
 */

// --------------------------------------------------------------- building

/**
 * One row per set, in the order the parser produced them.
 *
 * `ParseResponse.unresolved` is deliberately not read: it is derived from the
 * same entries (it is the list of queries whose `exercise` came back null), and
 * consulting both would make it possible for the two to disagree about whether
 * a row is loggable. The rows are the single source of truth from here on.
 *
 * Weights are rounded to whole pounds HERE, on the way in, rather than only at
 * render time. What the owner confirms has to be what is stored: a sheet that
 * shows `66` and writes `66.1386` is a sheet that lies, and the kg inputs that
 * rendered "66.1 lb" are exactly where that came from.
 */
export function rowsFromParse(parsed: Pick<ParseResponse, "entries">): LogRow[] {
  const entries = parsed.entries;
  const rows: LogRow[] = [];

  entries.forEach((entry, e) => {
    const entryKey = `e${e}`;
    const match = matchStateOf(entry.exercise?.confidence ?? null, entry.exercise !== null);

    entry.sets.forEach((set, s) => {
      rows.push({
        key: `${entryKey}-s${s}`,
        entryKey,
        query: entry.query,
        exerciseId: entry.exercise?.id ?? null,
        exerciseName: entry.exercise?.name ?? null,
        equipment: emptyToNull(entry.exercise?.equipment),
        match,
        // Kept for the two uncertain states only. On an `exact` match it is a
        // question nobody asked, and on an unmatched row it would compete with
        // the one button that fixes it. On `new` it is the guard against a
        // second bench press being created from "bnch pres"; on `fuzzy` it is
        // the far more likely correction than the one the matcher chose.
        nearMiss: match === "new" || match === "fuzzy" ? (entry.nearMiss ?? null) : null,
        dropped: entry.dropped ?? [],
        weightLb: Math.round(set.weight_lb),
        reps: set.reps,
        rpe: set.rpe,
        toFailure: set.to_failure,
        isWarmup: set.is_warmup,
        note: "",
      });
    });
  });

  return rows;
}

/**
 * The server's `confidence` string, as a state this sheet can draw.
 *
 * Unknown strings fall back to `"exact"` rather than to a louder state. A
 * future `confidence: "alias"` must not make every row in the sheet look
 * suspect; the loud states are the ones that cost the user a decision.
 */
function matchStateOf(confidence: string | null, resolved: boolean): MatchState {
  if (!resolved) return "none";
  if (confidence === "new") return "new";
  if (confidence === "fuzzy") return "fuzzy";
  return "exact";
}

function emptyToNull(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
}

/** A row for the "couldn't parse that" path, where the user logs it by hand. */
export function blankRow(exercise?: { id: string; name: string; equipment?: string } | null): LogRow {
  return {
    key: "manual-0",
    entryKey: "manual",
    query: "",
    exerciseId: exercise?.id ?? null,
    exerciseName: exercise?.name ?? null,
    equipment: emptyToNull(exercise?.equipment),
    // The user picked it, or the session screen knows which exercise is under
    // the thumb. Either way it is not a fuzzy match and must not be marked as
    // one — a `~` on a row the user chose themselves reads as a bug.
    match: exercise ? "exact" : "none",
    nearMiss: null,
    dropped: [],
    weightLb: 0,
    reps: 0,
    rpe: null,
    toFailure: false,
    isWarmup: false,
    note: "",
  };
}

// ------------------------------------------------------------------ groups

/**
 * The sheet's structure: one group per parsed entry, in first-appearance order.
 *
 * Grouped by `entryKey` and NOT by `exerciseId`, which matters in one case that
 * looks like a bug until you hit it: two lines that resolve to the same lift
 * stay two groups. Each carries its own raw wording, and the raw wording is the
 * evidence a fuzzy match needs — merge them and "incline smith press" and
 * "incline press" become one header with one `heard:` line that is wrong for
 * half the sets under it. They are also two phrases the server may have to
 * learn two different aliases for.
 *
 * Header fields are read off the first row. Every mutation that can change them
 * (`refileEntry`) moves the whole entry at once, so the rows of a group cannot
 * disagree about which exercise they are filed against.
 */
export function groupRows(rows: LogRow[]): SetGroup[] {
  const order: string[] = [];
  const groups = new Map<string, SetGroup>();

  for (const row of rows) {
    let group = groups.get(row.entryKey);
    if (group === undefined) {
      group = {
        entryKey: row.entryKey,
        query: row.query,
        exerciseId: row.exerciseId,
        exerciseName: row.exerciseName,
        equipment: row.equipment,
        match: row.match,
        nearMiss: row.nearMiss,
        dropped: row.dropped,
        rows: [],
      };
      groups.set(row.entryKey, group);
      order.push(row.entryKey);
    }
    group.rows.push(row);
  }

  // A group whose rows all went is not in `rows` at all, so it is not here
  // either — which is the whole reason this is a projection and not state.
  return order.map((key) => groups.get(key) as SetGroup);
}

/**
 * The group header's second line: `4 sets · RPE 8`.
 *
 * `MIXED` rather than the first row's value when the rows disagree. A single
 * figure there would be a claim about every set under it, and the owner's
 * session genuinely has warmups at no RPE followed by working sets at 8.
 */
export function groupSummary(group: SetGroup): string {
  const n = group.rows.length;
  return `${n} SET${n === 1 ? "" : "S"} · RPE ${rpeSummary(group.rows)}`;
}

/** `"—"`, `"8"`, `"7.5"` or `"MIXED"`. */
export function rpeSummary(rows: LogRow[]): string {
  if (rows.length === 0) return "—";
  const first = rows[0].rpe;
  if (!rows.every((row) => row.rpe === first)) return "MIXED";
  return first === null ? "—" : String(first);
}

/** Exercises this parse created, so a discard can take them away again. */
export function createdExerciseIds(rows: LogRow[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (row.match !== "new" || row.exerciseId === null) continue;
    if (!out.includes(row.exerciseId)) out.push(row.exerciseId);
  }
  return out;
}

// --------------------------------------------------------------- mutations

export function patchRow(rows: LogRow[], key: string, patch: RowPatch): LogRow[] {
  return rows.map((row) => (row.key === key ? { ...row, ...patch } : row));
}

/**
 * The same patch across every row of one entry.
 *
 * Fifteen sets is the normal case for this owner, so per-set tapping cannot be
 * the only path to "all of these were at RPE 8".
 */
export function patchGroup(rows: LogRow[], entryKey: string, patch: RowPatch): LogRow[] {
  return rows.map((row) => (row.entryKey === entryKey ? { ...row, ...patch } : row));
}

/**
 * "The first two were warmups" — the shape warmups actually take.
 *
 * The rows after the first `k` are set to WORKING, not left alone. The control
 * claims the first k are warmups and the others are not, and a stale `F` on a
 * row this just claimed was a working set would contradict the thing the user
 * pressed. `k` is clamped, so the stepper cannot run off either end.
 */
export function markFirstWarmups(rows: LogRow[], entryKey: string, k: number): LogRow[] {
  const total = rows.filter((row) => row.entryKey === entryKey).length;
  const limit = Math.max(0, Math.min(total, Math.round(k)));
  let seen = 0;

  return rows.map((row) => {
    if (row.entryKey !== entryKey) return row;
    const warmup = seen < limit;
    seen += 1;
    return { ...row, isWarmup: warmup, toFailure: false };
  });
}

/**
 * How many of these rows, from the front, are warmups.
 *
 * The inverse of `markFirstWarmups`, and the reason the warmup stepper needs no
 * state of its own: after a tap, this *is* the stepper's position. A warmup in
 * the middle of an exercise does not count — the control's claim is about a run
 * at the start, which is the shape warmups actually take.
 */
export function leadingWarmups(rows: LogRow[]): number {
  let n = 0;
  for (const row of rows) {
    if (!row.isWarmup) break;
    n += 1;
  }
  return n;
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

/** Every set of one entry, gone. The sheet writes nothing until confirm, so this needs no second question. */
export function deleteGroup(rows: LogRow[], entryKey: string): LogRow[] {
  return rows.filter((row) => row.entryKey !== entryKey);
}

/**
 * The correction path: every row of one entry moves to the chosen exercise.
 *
 * `query` is left untouched on purpose. It is what the user actually said, it
 * is what `POST /api/mobile/exercise/alias` has to learn, and it is what the
 * group header shows under a fuzzy match. Overwriting it with the canonical
 * name would make the correction unrepeatable and lose the evidence of what
 * went wrong.
 *
 * The match becomes `"exact"` and the near miss is cleared: the user has now
 * answered the only question either of them existed to ask.
 */
export function refileEntry(
  rows: LogRow[],
  entryKey: string,
  exercise: { id: string; name: string; equipment?: string },
): LogRow[] {
  return rows.map((row) =>
    row.entryKey === entryKey
      ? {
          ...row,
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          equipment: emptyToNull(exercise.equipment) ?? row.equipment,
          match: "exact" as const,
          nearMiss: null,
        }
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

// ------------------------------------------------------------- set kind

/** Warmup, working or to failure — one question with three answers. */
export type SetKind = "warmup" | "working" | "failure";

/**
 * The kind a row currently is.
 *
 * `isWarmup && toFailure` is meaningless and unreachable through the control,
 * but a parse can produce it ("warmup set to failure"). It resolves to
 * `failure`, which is the louder of the two and the one that matters to
 * progression; `kindPatch` then clears the warmup flag the next time the user
 * touches it.
 */
export function setKind(row: LogRow): SetKind {
  if (row.toFailure) return "failure";
  if (row.isWarmup) return "warmup";
  return "working";
}

/** The two flags for a kind. Always both, so the pair cannot drift apart. */
export function kindPatch(kind: SetKind): RowPatch {
  return {
    isWarmup: kind === "warmup",
    toFailure: kind === "failure",
  };
}

// ---------------------------------------------------------------- rpe

/**
 * The legal RPE answers, as the segmented control offers them.
 *
 * `null` first — "no RPE" is an answer and the commonest one, and it has to be
 * reachable in one tap from any value.
 */
export const RPE_CHOICES: readonly (number | null)[] = [null, 6, 7, 8, 9, 10];

/**
 * The choices, plus the current value when it is not one of them.
 *
 * `sets.rpe` is a `real` column and the parser can produce `7.5` from "@7.5",
 * so a control that offered only six integers would silently round a value the
 * database was perfectly happy with. A seventh segment appears for it, selected,
 * and disappears as soon as another value is chosen — which is how a legal
 * value stays representable without an eleven-option control for everyone else.
 */
export function rpeChoices(current: number | null): (number | null)[] {
  if (current === null || RPE_CHOICES.includes(current)) return [...RPE_CHOICES];
  return [...RPE_CHOICES, current];
}

/** The label for one segment. `—` is "no RPE", not "zero". */
export function rpeLabel(value: number | null): string {
  return value === null ? "—" : String(value);
}

// ---------------------------------------------------------------- readout

/**
 * Figures a set cannot have, and the sentence to say about them.
 *
 * This is defence in depth, not the fix. The owner's `165,5` typo became a set
 * of **165 reps at 165 lb** and nothing rejected it; the real repair is in the
 * parser, which now drops a chunk it cannot believe. This is here for the day
 * it emits something else — the sheet is the last place anything can be caught
 * before it is stored, and a 165-rep set is wrong in the trend chart forever.
 *
 * The ceilings are deliberately looser than the parser's (`maxReps: 100`,
 * `maxWeightLb: 2000`). The parser is deciding whether to believe text; this is
 * deciding whether to refuse something the user can see on screen and has had
 * the chance to edit. A hand-typed 60-rep set of band pull-aparts is real.
 */
export const MAX_PLAUSIBLE_REPS = 50;
export const MAX_PLAUSIBLE_LB = 1500;

interface Implausible {
  field: PadField | "rpe";
  reason: string;
}

function checkRow(row: LogRow): Implausible | null {
  if (row.reps > MAX_PLAUSIBLE_REPS) {
    return { field: "reps", reason: `${row.reps} reps isn’t a set.` };
  }
  if (row.reps < 1) {
    return { field: "reps", reason: "A set needs a rep count." };
  }
  if (row.weightLb > MAX_PLAUSIBLE_LB) {
    return { field: "weight", reason: `${fmtWeight(row.weightLb)} lb isn’t a lift.` };
  }
  if (row.rpe !== null && (row.rpe < 1 || row.rpe > 10)) {
    return { field: "rpe", reason: `RPE ${row.rpe} isn’t on the scale.` };
  }
  return null;
}

/** Why this row cannot be logged, in the user's terms, or `null`. */
export function implausible(row: LogRow): string | null {
  return checkRow(row)?.reason ?? null;
}

/** Which figure on the line to draw in `color.bad`. */
export function offendingField(row: LogRow): PadField | "rpe" | null {
  return checkRow(row)?.field ?? null;
}

/** Every row must have a real exercise and believable numbers before anything is written. */
export function canConfirm(rows: LogRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.exerciseId !== null && implausible(row) === null);
}

/**
 * What the confirm button says, counting only the sets that could be written.
 *
 * The owner's paste produced fifteen rows, one of which was a 165-rep set that
 * nothing can store. `LOG 15 SETS` over a disabled button would be a promise
 * about a row the sheet is refusing; `LOG 14 SETS` is the number they will
 * actually get once the bad line is deleted, which is also the next thing they
 * are going to do.
 *
 * It follows that a by-hand row with no reps yet reads `NOTHING TO LOG` until a
 * rep count is typed. That is the honest label — an empty row is not a set —
 * and `blockedReason` says so in words directly above it.
 */
export function confirmLabel(rows: LogRow[]): string {
  const n = rows.filter((row) => implausible(row) === null).length;
  if (n === 0) return "NOTHING TO LOG";
  return `LOG ${n} SET${n === 1 ? "" : "S"}`;
}

/**
 * Why the confirm button is disabled, in the user's terms.
 *
 * A greyed-out button with no explanation is the worst version of this: the one
 * thing the user cannot do is the one thing they came here for, and the reason
 * is a `null` three layers down.
 *
 * A missing rep count is checked before the other implausible figures and gets
 * its own sentence, because it is the by-hand row's starting state rather than
 * a bad parse — "fix it or delete it" is wrong advice for the one empty row the
 * user just asked for.
 */
export function blockedReason(rows: LogRow[]): string | null {
  if (rows.length === 0) return null;

  const unmatched = unmatchedQueries(rows);
  if (unmatched.length > 0) {
    return `Pick an exercise for ${unmatched.map((q) => `“${q}”`).join(" and ")}.`;
  }
  /*
    A row with no exercise and no wording — the by-hand path, opened from a
    screen that did not know which exercise was under the thumb. There is no
    quotation to name it with, and `unmatchedQueries` skips it precisely
    because printing `“”` would be worse than saying nothing. Saying nothing is
    what left the button disabled with no reason given, which is the one
    outcome this function exists to prevent.
  */
  if (rows.some((row) => row.exerciseId === null)) return "Pick an exercise for this set.";
  if (rows.some((row) => row.reps < 1)) return "Every set needs a rep count.";

  for (const row of rows) {
    const reason = implausible(row);
    if (reason !== null) return `One set can’t be logged — ${reason} Fix it or delete it.`;
  }
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
    note: row.note,
    rawText,
  }));
}

// ----------------------------------------------------------- number entry

/** The NumberPad's raw digit string for a field's current value. */
export function fieldToPad(row: LogRow, field: PadField): string {
  return String(field === "weight" ? row.weightLb : row.reps);
}

/**
 * The pad's string back into the row, clamped to what the column accepts.
 *
 * Weight is rounded to a WHOLE pound, which is a deliberate loss: a 227.5 lb
 * load (one pair of 2.5s) stores as 228, a 0.2% error on one set. The owner
 * asked for it and it is the right trade — display is always lb and always
 * whole, so a figure with a phantom `.1` tail reads as a bug on every row
 * forever. Storage stays kg and the conversion still happens at the edge; what
 * is gone is the half-pound, not the kilogram.
 */
export function padToPatch(field: PadField, raw: string): RowPatch {
  const n = raw === "" ? 0 : Number(raw);
  if (!Number.isFinite(n)) return {};

  if (field === "reps") return { reps: Math.max(0, Math.round(n)) };
  return { weightLb: Math.max(0, Math.round(n)) };
}

export const PAD_META: Record<PadField, { label: string; unit: string; allowDecimal: boolean }> = {
  // `allowDecimal: false` on weight is the other half of the rounding decision.
  // Offering a `.` and then throwing the decimal away is worse than not
  // offering it: the user types 227.5, sees 228, and cannot tell which part of
  // the app is broken.
  weight: { label: "WEIGHT", unit: "lb", allowDecimal: false },
  reps: { label: "REPS", unit: "reps", allowDecimal: false },
};

// ----------------------------------------------------------------- format

/** `185`, `228`, `0` — whole pounds, always. See `padToPatch`. */
export function fmtWeight(lb: number): string {
  return String(Math.round(lb));
}

// -------------------------------------------------------------- provenance

/** Which door the text came in through. Drives the label AND the hint. */
export type SourceKind = "typed" | "heard";

/** `TYPED · TAP TO FIX`. The whole line is the tap target. */
export function sourceDoorLabel(kind: SourceKind): string {
  return `${kind === "heard" ? "HEARD" : "TYPED"} · TAP TO FIX`;
}

/**
 * What actually read this, stated at the granularity the server reports.
 *
 * ── WHY THE OLD TWO STRINGS BOTH LIED ──────────────────────────────────────
 *
 * The sheet used to print `READ BY THE MODEL` or `READ WITHOUT THE NETWORK`
 * off one boolean, and both were wrong in a way the owner noticed.
 *
 *  - `READ BY THE MODEL` marks the WHOLE paste as modelled. `usedModel` is
 *    true when the deterministic parser left *any* line over, so one stray
 *    line — a blank, a stray "165,5" — stamps that label across fourteen rows
 *    that were parsed character for character. Measured against the owner's
 *    own paste: every set line of it parses offline, and the sheet still said
 *    the model had read it. The effect is that the one label meant to tell you
 *    how hard to check the rows tells you to check all of them, always, which
 *    is the same as telling you nothing.
 *  - `READ WITHOUT THE NETWORK` is simply false. The parse is
 *    `POST /api/sets/parse`; the text crosses the network either way. What is
 *    absent in that case is a language MODEL, not the network — and on the mic
 *    path a model transcribed the audio before the parser ever saw it, so that
 *    string was claiming no model on a payload a model produced.
 *
 * So the hint now names the stage rather than the paste. `usedModel` says
 * exactly one thing, and it is said back verbatim: a model read **the lines
 * the parser could not**. That is true when it read one line of five and still
 * true when the parser managed none of them and it read all five, so there is
 * no case where this sentence over- or under-claims.
 *
 * ── WHAT WAS REJECTED, AND WHY ─────────────────────────────────────────────
 *
 * A per-ENTRY badge is the thing to want and it is not computable on this
 * phone. `parseSetsText` splices the model's entries in among the
 * deterministic ones and sends no marker on either, so nothing in
 * `ParseResponse` says which rows came from where; `dropped` is not that
 * marker, because both paths now emit it. A count has the same problem.
 *
 * Re-deriving it client-side — checking each set's figures against the digits
 * in the source line — was also rejected, and the reason is worth keeping: a
 * deterministically parsed `20kg` becomes `44 lb`, whose digits appear nowhere
 * in what the owner typed, so that check would flag the parser's most reliable
 * conversion as model guesswork. A verifier that cries wolf on correct rows is
 * worse than the over-broad label it replaces.
 *
 * The honest per-entry version needs one additive boolean from the server and
 * belongs with that change, not here.
 */
export function parseHint(kind: SourceKind, usedModel: boolean): string {
  if (kind === "heard") {
    return usedModel
      ? "A MODEL HEARD IT AND READ THE LINES THE PARSER COULDN’T"
      : "A MODEL HEARD IT · THE PARSER READ EVERY SET";
  }
  return usedModel
    ? "A MODEL READ THE LINES THE PARSER COULDN’T"
    : "NO MODEL · THE PARSER READ EVERY LINE";
}

// --------------------------------------------------------------------- cues

/**
 * The carry-forward cue, and what this module is allowed to know about it.
 *
 * A cue is pinned to an EXERCISE and lives on the server
 * (`exercise_cues`, `POST /api/mobile/exercise/cue`). It is not a set note:
 * `LogRow.note` is one line about one set in one session, and it scrolls away
 * behind you. The owner asked for notes "per exercise" and the answer they
 * chose was carry-forward — written once, shown every time that lift is
 * logged, until they change it. The two coexist and neither is the other's
 * default.
 *
 * Nothing here talks to the network. These are the rules the sheet needs so it
 * can refuse a cue the server would refuse, measure it the way the server
 * measures it, and index the map the way the server builds it.
 */
export const MAX_CUE_LENGTH = 240;

/**
 * A mirror of `normaliseCue` in `src/lib/cues.ts`. Keep the two identical.
 *
 * It exists on the phone for ONE reason: the length limit is enforced after
 * normalisation on the server, so a client that measured the raw draft would
 * reject a 243-character cue with three trailing newlines that the server
 * would have stored happily — and would let through a draft that normalises to
 * 241 and comes back a 400. Measuring the same string both sides is the only
 * way the inline counter and the server agree.
 *
 * It is deliberately NOT used to decide what to render. The response's `cue`
 * is what gets rendered, because the server is the one that normalised it.
 *
 * Line breaks survive: they are how two cues sit on one lift ("elbows tucked"
 * above "pause on chest"), and collapsing them would throw away the only
 * formatting this field has. `""` means "no cue" and asks for a delete.
 */
export function normaliseCue(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Why this draft cannot be saved, in the owner's terms, or `null`.
 *
 * Checked on the phone so a cue typed between sets does not cost a round trip
 * to be told it is too long. The server answers 400 with its own sentence past
 * the same ceiling, so this is a courtesy, never the enforcement.
 */
export function cueError(raw: string): string | null {
  const cue = normaliseCue(raw);
  if (cue.length <= MAX_CUE_LENGTH) return null;
  return `That is ${cue.length} characters. A cue has to be ${MAX_CUE_LENGTH} or fewer.`;
}

/**
 * This group's cue, or `null`.
 *
 * `undefined` and `null` both mean "no cue" and they arrive by different
 * roads — a lift with nothing written is ABSENT from `cues` (the server's
 * rule, so `cues[id] === undefined` is the single answer to "is there one"),
 * and an unresolved or by-hand group has no exercise id to look one up with.
 * Both collapse to `null` here so the view has one case to draw.
 *
 * `cues` is optional on `Bootstrap` because a server that predates the field
 * sends nothing, and that has to render as no cues rather than as a crash.
 */
export function cueFor(
  exerciseId: string | null,
  cues: Record<string, string> | undefined,
): string | null {
  if (exerciseId === null || cues === undefined) return null;
  return cues[exerciseId] ?? null;
}

/**
 * The outbox id a queued cue takes, which is deliberately not random.
 *
 * `enqueue` keys the queue on this, and the store's `put` is an upsert on it —
 * so deriving it from the exercise makes a second edit of the same lift REPLACE
 * the queued write rather than line up behind it. Three edits to the bench cue
 * in a basement leave one queued item carrying the last thing the owner typed,
 * which is both what they meant and the only version worth a round trip.
 *
 * The prefix is what keeps it out of the way of a set: a set's id is its
 * `client_id` and is a uuid, and `cue-` cannot be one.
 */
export function cueQueueId(exerciseId: string): string {
  return `cue-${exerciseId}`;
}

/**
 * Whether a failed cue write is worth queueing, or is the owner's problem to
 * fix now.
 *
 * It defers to `classifyStatus`, the same function the outbox itself uses to
 * decide what to retry, rather than restating the rule — a cue that this says
 * to queue and the queue then classifies as permanent would be accepted on
 * screen and dropped in the background, which is the one outcome worse than
 * refusing it outright.
 *
 * So: a dead connection or a 5xx queues, because the words are good and only
 * the network is bad. A 400 (past the ceiling) or a 404 (a lift the server
 * cannot see) does NOT queue — it will be just as invalid in ten minutes, and
 * the editor stays open saying why. A 401 is retryable in the queue's terms and
 * queues here too: the cue is valid and will deliver once the session refreshes.
 */
export function shouldQueueCue(status: number): boolean {
  return classifyStatus(status) === "retry";
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

function uniqueKey(rows: LogRow[], base: string): string {
  const taken = new Set(rows.map((row) => row.key));
  for (let n = 2; ; n += 1) {
    const candidate = `${base}·${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

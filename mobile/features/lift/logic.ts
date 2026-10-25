import type {
  CatalogueExercise,
  Felt,
  LastSet,
  RankedMuscle,
  SessionSet,
  SetWrite,
} from "@/lib/types";
import type { OutboxItem } from "@/lib/shared/outbox";

/**
 * Everything in the live session that is a decision rather than a view.
 *
 * It is a separate file with **type-only** imports so it can be unit-tested in
 * plain node: there is no native runtime in this container, so anything that
 * imports `react-native` is unverifiable here. The three rules that would
 * silently corrupt a session if they were wrong — which set is drawn, which
 * numbers the hero button will log, and whether a queued set and its delivered
 * server row are the same set — all live here and all have tests.
 *
 * `import type` is load-bearing, not stylistic: esbuild erases it, so the
 * `@/lib/*` aliases never need resolving in the test runner.
 */

// ---------------------------------------------------------------- constants

/** The default rest, and the only one. A configurable timer is a settings screen nobody opens. */
export const REST_DEFAULT_S = 120;

/** The web app's "owed sets" cutoff on `volume.ranked[].score`. Same number, same meaning. */
export const OWED_SCORE_THRESHOLD = 0.2;

/**
 * The lowest contribution that counts as "this exercise trains that muscle"
 * for the purpose of pinning it in the picker.
 *
 * `exercise_muscles.contribution` is 1 for a prime mover and 0.5 for a real
 * secondary; anything below that is incidental. Pinning Back Squat under
 * "owed: forearms" because it has a 0.25 grip contribution would make the
 * pinned list meaningless.
 */
export const OWED_CONTRIBUTION_FLOOR = 0.5;

/** Keep the pinned block short enough to read without scrolling. */
export const OWED_PIN_LIMIT = 8;

// -------------------------------------------------------------------- types

/** The fields a set needs to be drawn, wherever it came from. */
export interface LocalSet {
  clientId: string;
  exerciseId: string;
  reps: number;
  weightLb: number;
  rpe: number | null;
  toFailure: boolean;
  isWarmup: boolean;
  felt: Felt;
  /** ISO 8601. Stamped on the phone when the set was logged, not when it arrived. */
  loggedAt: string;
}

export interface DisplaySet extends LocalSet {
  /** Stable across the queued → delivered transition, so React does not remount the pill. */
  key: string;
  /** The server row's id. `null` while the set is still only on this phone. */
  id: string | null;
  /** Drawn with a dashed border: on this phone, not yet on the server. */
  queued: boolean;
}

/** What the user has changed by hand on one exercise's card. */
export interface Draft {
  weightLb?: number;
  reps?: number;
  rpe: number | null;
  toFailure: boolean;
  isWarmup: boolean;
  felt: Felt;
  note: string;
}

export const emptyDraft = (): Draft => ({
  rpe: null,
  toFailure: false,
  isWarmup: false,
  felt: null,
  note: "",
});

export interface SuggestPair {
  baseline: { action: string; weightLb: number; sets: number; reps: number; reason: string };
  suggestion: { weightLb: number; sets: number; reps: number; reason: string } | null;
  clamped: boolean;
}

export interface PagerExercise {
  id: string;
  name: string;
  incrementLb: number;
  equipment: string;
}

// ------------------------------------------------------- reading the outbox

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function felt(v: unknown): Felt {
  return v === "weak" || v === "normal" || v === "strong" ? v : null;
}

/**
 * Turns a queued outbox row back into a set that can be drawn.
 *
 * Returns `null` rather than a half-filled set for anything it cannot read.
 * The queue is durable storage: a row can outlive the build that wrote it, and
 * a payload from an older schema must disappear from the session rather than
 * render as `NaN × undefined`. It still gets delivered — `flush()` does not
 * consult this — so nothing is lost, it just is not drawn.
 */
export function queuedSetFromItem(item: OutboxItem): LocalSet | null {
  if (item.kind !== "set") return null;

  const p = item.payload;
  const clientId = str(p.clientId) ?? str(item.id);
  const exerciseId = str(p.exerciseId);
  const reps = num(p.reps);
  const weightLb = num(p.weightLb);

  if (!clientId || !exerciseId || reps === null || weightLb === null) return null;

  return {
    clientId,
    exerciseId,
    reps,
    weightLb,
    rpe: num(p.rpe),
    toFailure: p.toFailure === true,
    isWarmup: p.isWarmup === true,
    felt: felt(p.felt),
    loggedAt: str(p.loggedAt) ?? new Date(item.createdAt).toISOString(),
  };
}

/** The queued session start, if there is one. Its `createdAt` is the local start time. */
export function findQueuedStart(items: OutboxItem[]): OutboxItem | null {
  return items.find((i) => i.kind === "session-start") ?? null;
}

export const queuedSetCount = (items: OutboxItem[]): number =>
  items.filter((i) => i.kind === "set").length;

// ------------------------------------------------------------ reconciliation

/**
 * One list of sets out of three sources, deduplicated by `clientId`.
 *
 * This is the whole optimistic story, and the reason it matches on `clientId`
 * rather than counting is that all three sources move independently: the server
 * list is refetched on a timer, the queue drains in the background, and the
 * local list is appended to the instant a button is pressed. A refetch that
 * lands between a successful POST and the queue publishing its new length sees
 * the same set in two places at once — and counting would either draw it twice
 * or, worse, decide a set is missing and drop one the user actually did.
 *
 * Precedence is server → queue → local, which is also oldest-truth-first:
 *
 *  - **server** is the only source with a row id, so it is the only one a
 *    delete can act on.
 *  - **queue** is durable, so it survives the app being killed mid-session and
 *    is what redraws the session on relaunch.
 *  - **local** exists only to cover the few milliseconds between the press and
 *    the SQLite write publishing, so the pill appears on the same frame as the
 *    haptic.
 */
export function mergeSets(
  server: SessionSet[],
  queued: LocalSet[],
  local: LocalSet[],
): DisplaySet[] {
  const out: DisplaySet[] = [];
  const seenClientIds = new Set<string>();

  for (const s of server) {
    // A server row can legitimately have no clientId: sets logged from the web
    // app go straight to Postgres and never pass through an outbox. Those are
    // keyed by their row id and can never collide with a queued set.
    if (s.clientId !== null) {
      if (seenClientIds.has(s.clientId)) continue;
      seenClientIds.add(s.clientId);
    }

    out.push({
      key: s.clientId ?? `srv:${s.id}`,
      id: s.id,
      queued: false,
      clientId: s.clientId ?? s.id,
      exerciseId: s.exerciseId,
      reps: s.reps,
      weightLb: s.weightLb,
      rpe: s.rpe,
      toFailure: s.toFailure,
      isWarmup: s.isWarmup,
      felt: s.felt,
      loggedAt: s.loggedAt,
    });
  }

  for (const q of queued) {
    if (seenClientIds.has(q.clientId)) continue;
    seenClientIds.add(q.clientId);
    out.push({ ...q, key: q.clientId, id: null, queued: true });
  }

  for (const l of local) {
    if (seenClientIds.has(l.clientId)) continue;
    seenClientIds.add(l.clientId);
    out.push({ ...l, key: l.clientId, id: null, queued: true });
  }

  // By when the set was logged, not by when it was learned about. A queued set
  // from ten minutes ago must not jump above a server set logged after it just
  // because the queue was read second.
  return out.sort(
    (a, b) => Date.parse(a.loggedAt) - Date.parse(b.loggedAt) || a.key.localeCompare(b.key),
  );
}

/**
 * Which local optimistic rows have been taken over by durable storage.
 *
 * Either source is enough: a row in the queue is in SQLite and will survive the
 * app being killed, so the in-memory copy has no further job. Keeping it would
 * mean the local list grows for the whole session and the merge does more work
 * on every render for no benefit.
 */
export function pruneLocal(
  local: LocalSet[],
  server: SessionSet[],
  queued: LocalSet[],
): LocalSet[] {
  const known = new Set<string>();
  for (const s of server) if (s.clientId !== null) known.add(s.clientId);
  for (const q of queued) known.add(q.clientId);
  return local.filter((l) => !known.has(l.clientId));
}

export const setsForExercise = (sets: DisplaySet[], exerciseId: string): DisplaySet[] =>
  sets.filter((s) => s.exerciseId === exerciseId);

/** The most recent set logged against this exercise in this session, warmups included. */
export function lastSetInSession(sets: DisplaySet[], exerciseId: string): DisplaySet | null {
  const mine = setsForExercise(sets, exerciseId);
  return mine.length > 0 ? mine[mine.length - 1] : null;
}

// ------------------------------------------------------------------- pager

/**
 * The pager's pages: every exercise touched this session in the order it was
 * first performed, then anything added from the picker that has no sets yet.
 *
 * Order is by first set rather than by latest, so going back to bench after
 * squats does not make the pages shuffle under the user's thumb.
 */
export function sessionExercises(
  sets: DisplaySet[],
  addedIds: string[],
  catalogue: CatalogueExercise[],
): PagerExercise[] {
  const byId = new Map(catalogue.map((e) => [e.id, e]));
  const order: string[] = [];
  const seen = new Set<string>();

  for (const s of sets) {
    if (seen.has(s.exerciseId)) continue;
    seen.add(s.exerciseId);
    order.push(s.exerciseId);
  }
  for (const id of addedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }

  return order.map((id) => {
    const e = byId.get(id);
    return {
      id,
      // A set can exist for an exercise the cached catalogue does not have —
      // the catalogue came down in `bootstrap` and the set may have been logged
      // on the web since. Naming it honestly beats rendering a blank card.
      name: e?.name ?? "Exercise",
      incrementLb: e?.incrementLb && e.incrementLb > 0 ? e.incrementLb : 5,
      equipment: e?.equipment ?? "",
    };
  });
}

// ------------------------------------------------------------------ prefill

export interface Entry {
  weightLb: number | null;
  reps: number | null;
  /** Where the numbers came from, so the card can say when it is guessing. */
  source: "draft" | "session" | "history" | "suggest" | "none";
}

/**
 * What the hero button will log, in priority order.
 *
 * The draft wins outright. That matters because `/api/session/suggest` is
 * fired off when a page gains focus and can return a second or two later — long
 * enough for the user to have already tapped `+` twice. A suggestion that
 * overwrote a deliberate adjustment would be the single most infuriating bug in
 * this screen, so anything the user has touched is never reconsidered.
 */
export function resolveEntry(
  draft: Draft | undefined,
  sessionLast: Pick<LocalSet, "weightLb" | "reps"> | null,
  history: LastSet | undefined,
  suggest: SuggestPair | null,
): Entry {
  if (draft?.weightLb !== undefined && draft.reps !== undefined) {
    return { weightLb: draft.weightLb, reps: draft.reps, source: "draft" };
  }

  const base: Entry =
    sessionLast !== null
      ? { weightLb: sessionLast.weightLb, reps: sessionLast.reps, source: "session" }
      : history !== undefined
        ? { weightLb: history.weightLb, reps: history.reps, source: "history" }
        : suggest !== null
          ? pickSuggested(suggest)
          : { weightLb: null, reps: null, source: "none" };

  // A half-filled draft (the user opened the pad on reps only) overrides just
  // that field and leaves the other one on whatever the fallback produced.
  return {
    weightLb: draft?.weightLb ?? base.weightLb,
    reps: draft?.reps ?? base.reps,
    source: draft?.weightLb !== undefined || draft?.reps !== undefined ? "draft" : base.source,
  };
}

function pickSuggested(s: SuggestPair): Entry {
  const target = s.suggestion ?? s.baseline;
  return { weightLb: target.weightLb, reps: target.reps, source: "suggest" };
}

export const canLog = (e: Entry): boolean =>
  e.weightLb !== null && e.reps !== null && e.reps >= 1;

/**
 * The hero button's label, which is the set it is about to write — not "LOG
 * SET". Reading the numbers off the button is what makes one tap safe: there is
 * nothing to check afterwards and nothing to undo.
 */
export function heroLabel(e: Entry, isWarmup: boolean): string {
  if (!canLog(e)) return "SET WEIGHT";
  const body = `LOG ${fmtWeight(e.weightLb as number)} × ${e.reps}`;
  // Warmup survives a save on purpose — warmups come in threes — so it has to
  // be legible on the button, or the fourth tap silently files a working set as
  // a warmup and the week's volume is quietly wrong.
  return isWarmup ? `${body} · WARMUP` : body;
}

/** No trailing `.0`: weights are whole numbers 99% of the time and `185.0 lb` reads as a bug. */
export function fmtWeight(lb: number): string {
  const r = Math.round(lb * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// ------------------------------------------------------------------ steppers

/** Weight never goes below zero — bodyweight and assisted movements log as 0 lb. */
export function stepWeight(current: number | null, incrementLb: number, dir: 1 | -1): number {
  const inc = incrementLb > 0 ? incrementLb : 5;
  const from = current ?? 0;
  return Math.max(0, Math.round((from + dir * inc) * 10) / 10);
}

export function stepReps(current: number | null, dir: 1 | -1): number {
  return Math.max(1, (current ?? 1) + dir);
}

/**
 * The `NumberPad` emits a raw digit string and deliberately does not parse, so
 * this is where `""` becomes "untouched" rather than 0 lb — the distinction the
 * pad's contract exists to preserve.
 */
export function padToNumber(raw: string): number | null {
  if (raw === "" || raw === ".") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export const numberToPad = (v: number | null): string => (v === null ? "" : fmtWeight(v));

// ------------------------------------------------------------------- payload

/**
 * The body of `POST /api/sets`, which the outbox carries.
 *
 * `rawText` is empty for a set logged by hand; it exists so a set that came
 * from speech or shorthand keeps what was actually said, and a mangled parse
 * can be revisited months later.
 */
export function buildSetPayload(args: {
  clientId: string;
  exerciseId: string;
  entry: Entry;
  draft: Draft;
}): SetWrite | null {
  const { clientId, exerciseId, entry, draft } = args;
  if (!canLog(entry)) return null;

  return {
    clientId,
    exerciseId,
    reps: entry.reps as number,
    weightLb: entry.weightLb as number,
    rpe: draft.rpe,
    toFailure: draft.toFailure,
    isWarmup: draft.isWarmup,
    felt: draft.felt,
    note: draft.note.trim(),
    rawText: "",
  };
}

/**
 * What the card looks like after a save.
 *
 * Weight, reps and warmup survive; RPE, to-failure, felt and the note do not.
 * That split is the whole reason the next set costs one tap: the two numbers
 * that are usually the same are kept, and the four annotations that describe
 * one specific set are cleared so they cannot be silently reused.
 */
export function draftAfterSave(draft: Draft, entry: Entry): Draft {
  return {
    weightLb: entry.weightLb ?? undefined,
    reps: entry.reps ?? undefined,
    isWarmup: draft.isWarmup,
    rpe: null,
    toFailure: false,
    felt: null,
    note: "",
  };
}

/** The optimistic row drawn on the same frame as the press. */
export function localSetFrom(payload: SetWrite, loggedAt: string): LocalSet {
  return {
    clientId: payload.clientId,
    exerciseId: payload.exerciseId,
    reps: payload.reps,
    weightLb: payload.weightLb,
    rpe: payload.rpe ?? null,
    toFailure: payload.toFailure ?? false,
    isWarmup: payload.isWarmup ?? false,
    felt: payload.felt ?? null,
    loggedAt,
  };
}

// -------------------------------------------------------------- session gate

export interface SessionState {
  active: boolean;
  /** `true` while the start is queued and the server has not confirmed a workout. */
  pending: boolean;
  /** Epoch ms the elapsed clock runs from, or `null` when there is no session. */
  startedAtMs: number | null;
}

/**
 * Whether we are in a session, and what the clock counts from.
 *
 * The awkward case is the half-second after an offline start is finally
 * delivered: the queued row is gone, so `queuedStartAt` is `null`, but
 * `/api/mobile/session` has not been refetched yet, so `activeStartedAt` is
 * still `null` too. Deciding from those two alone would bounce the user out of
 * a live session and back to START LIFT mid-set. `localStartedAt` — React state
 * set the moment START was pressed — is what covers that window, and it is only
 * cleared by stopping or by the start being dropped.
 */
export function deriveSessionState(input: {
  activeStartedAt: string | null;
  localStartedAt: number | null;
  queuedStartAt: number | null;
}): SessionState {
  const { activeStartedAt, localStartedAt, queuedStartAt } = input;

  if (activeStartedAt !== null) {
    const parsed = Date.parse(activeStartedAt);
    return {
      active: true,
      pending: false,
      // A server timestamp that will not parse is not worth losing the session
      // over; fall back to whatever local mark we have, then to nothing.
      startedAtMs: Number.isNaN(parsed) ? (localStartedAt ?? queuedStartAt) : parsed,
    };
  }

  const local = localStartedAt ?? queuedStartAt;
  if (local !== null) return { active: true, pending: true, startedAtMs: local };

  return { active: false, pending: false, startedAtMs: null };
}

export const elapsedMin = (startedAtMs: number | null, nowMs: number): number =>
  startedAtMs === null ? 0 : Math.max(0, Math.round((nowMs - startedAtMs) / 60_000));

// ------------------------------------------------------------------ labels

/** `1:27`. Clamped at zero so a late timer tick cannot render `-0:01`. */
export function restLabel(remainingS: number): string {
  const s = Math.max(0, Math.round(remainingS));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * `LAST: 185 × 5 × 3 @7 · 4d ago`, or `FIRST TIME`.
 *
 * `lastSets[id].weightLb` is the modal set of the last completed session rather
 * than its heaviest, which is what makes repeating it land on the work actually
 * done: three at 185 plus one dropped set at 135 was a 185 session.
 */
export function lastLine(history: LastSet | undefined, today: string): string {
  if (history === undefined) return "FIRST TIME";

  const rpe = history.rpe !== null ? ` @${history.rpe}` : "";
  const when = relativeDay(history.localDate, today);
  return `LAST: ${fmtWeight(history.weightLb)} × ${history.reps} × ${history.sets}${rpe} · ${when}`;
}

/**
 * Days between two `YYYY-MM-DD` strings.
 *
 * Parsed as UTC midnight deliberately. Both strings are already the user's
 * local calendar dates — the server resolved the timezone — so re-interpreting
 * them in the device's zone is how "yesterday" becomes "today" for anyone west
 * of UTC. Comparing two UTC midnights is just arithmetic on calendar days.
 */
export function relativeDay(date: string, today: string): string {
  const a = Date.parse(`${date}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return date;

  const days = Math.round((b - a) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export interface PillParts {
  main: string;
  rpe: string | null;
  failure: boolean;
}

export const pillParts = (s: DisplaySet): PillParts => ({
  main: `${fmtWeight(s.weightLb)} × ${s.reps}`,
  rpe: s.rpe !== null ? ` @${s.rpe}` : null,
  failure: s.toFailure,
});

// ------------------------------------------------------------------- owed

/** The muscles behind on volume, highest debt first. `ranked` already arrives sorted. */
export const owedMuscles = (ranked: RankedMuscle[]): RankedMuscle[] =>
  ranked.filter((m) => m.score > OWED_SCORE_THRESHOLD);

export const owedLine = (ranked: RankedMuscle[], limit = 3): string =>
  owedMuscles(ranked)
    .slice(0, limit)
    .map((m) => m.label)
    .join(" · ");

// ------------------------------------------------------------------ picker

export const normalise = (s: string): string => s.toLowerCase().trim().replace(/\s+/g, " ");

/**
 * Case-insensitive substring over name and slug.
 *
 * Substring, not prefix: "pull up" has to find "Weighted Pull-Up", and the
 * whole point of the picker is that two or three characters is enough. The slug
 * is searched too because it is hyphenated, so typing "incline" matches
 * `incline-dumbbell-press` even if the display name is punctuated differently.
 */
export function filterCatalogue(
  catalogue: CatalogueExercise[],
  query: string,
): CatalogueExercise[] {
  const q = normalise(query);
  if (q === "") return catalogue;
  const slugQ = q.replace(/ /g, "-");
  return catalogue.filter(
    (e) => normalise(e.name).includes(q) || e.slug.includes(slugQ) || e.slug.includes(q),
  );
}

/**
 * Splits the picker's list into what you owe and everything else.
 *
 * The pinned block is the one piece of coaching in this screen: the catalogue
 * is 35 rows and the three muscles you are behind on are the reason you are
 * looking at it. Pinned rows are ordered by how badly they are owed, so the
 * first row is the most useful one.
 */
export function partitionByOwed(
  matches: CatalogueExercise[],
  ranked: RankedMuscle[],
): { owed: CatalogueExercise[]; rest: CatalogueExercise[] } {
  const debt = new Map(owedMuscles(ranked).map((m) => [m.muscle, m.score]));
  if (debt.size === 0) return { owed: [], rest: matches };

  const scored = matches.map((e) => {
    let best = 0;
    for (const m of e.muscles) {
      if (m.contribution < OWED_CONTRIBUTION_FLOOR) continue;
      best = Math.max(best, debt.get(m.muscle) ?? 0);
    }
    return { exercise: e, score: best };
  });

  const owed = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name))
    .slice(0, OWED_PIN_LIMIT)
    .map((s) => s.exercise);

  const pinned = new Set(owed.map((e) => e.id));
  return { owed, rest: matches.filter((e) => !pinned.has(e.id)) };
}

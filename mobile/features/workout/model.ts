import type { CatalogueExercise, LastSet } from "@/lib/types";
import { hardSetsByMuscle, muscleLabel, type CountedSet } from "@/lib/shared/muscles";
import { kindFlags, setKindOf } from "../../lib/set-kind";
import { fmtWeight, type DisplaySet, type SetEdit } from "../lift/logic";

import type { WorkoutDetail, WorkoutDetailSet, WorkoutSetWrite } from "./types";

/**
 * Everything on the past-workout screen that is a decision rather than a view.
 *
 * Pure, like `lift/logic.ts`, so it runs under vitest in plain node. The screen
 * groups, labels, totals and prefills through here and nothing else; the
 * server decides what may be written (`src/lib/workout-edit.ts`).
 */

// ------------------------------------------------------------ query keys

/**
 * Local rather than in `lib/query.ts`, which nobody edits this round. The
 * shape matches `queryKeys.exercise` so the two read alike in a devtools list.
 */
export const workoutKey = (id: string) => ["workout", id] as const;

/**
 * Every cache entry a past-workout write makes stale.
 *
 * The workout itself; bootstrap, because the Lift tab's recent-workouts card,
 * Today's volume and every e1RM series read it; and the history of each lift
 * touched, which is what Exercise detail draws.
 */
export function staleKeys(workoutId: string, exerciseIds: string[]): (readonly string[])[] {
  return [
    workoutKey(workoutId),
    ["bootstrap"],
    ...[...new Set(exerciseIds)].map((id) => ["exercise", id] as const),
  ];
}

// --------------------------------------------------------------- grouping

export interface SetRowView {
  set: WorkoutDetailSet;
  /** `W` for a warmup, else the working-set number within the exercise. */
  label: string;
  /** `185 × 5`. */
  figure: string;
  /** `@8`, or null. */
  rpe: string | null;
  warmup: boolean;
  failure: boolean;
}

export interface ExerciseGroup {
  exerciseId: string;
  name: string;
  rows: SetRowView[];
  /** The last set logged for this lift in this workout — what "+ Add set" copies. */
  last: WorkoutDetailSet;
}

/**
 * Sets → one group per exercise, in the order each was FIRST performed.
 *
 * Not alphabetical and not by set count: a workout reads top to bottom the way
 * it was trained, so bench done first is the first card. Within a group the
 * sets stay in logged order, and working sets are numbered 1, 2, 3 with
 * warmups lettered W and left out of the count — the way a lifter says "my
 * third set", which never means the third warmup.
 *
 * A failure set keeps its number and carries an `F` as well: it was still the
 * third working set, it just ended at failure.
 */
export function groupByExercise(detail: WorkoutDetail): ExerciseGroup[] {
  const ordered = [...detail.sets].sort((a, b) => Date.parse(a.loggedAt) - Date.parse(b.loggedAt));
  const groups = new Map<string, ExerciseGroup>();

  for (const set of ordered) {
    let group = groups.get(set.exerciseId);
    if (group === undefined) {
      group = { exerciseId: set.exerciseId, name: set.exerciseName, rows: [], last: set };
      groups.set(set.exerciseId, group);
    }
    const kind = setKindOf(set);
    const working = group.rows.filter((r) => !r.warmup).length;
    group.rows.push({
      set,
      label: kind === "warmup" ? "W" : String(working + 1),
      figure: `${fmtWeight(set.weightLb)} × ${set.reps}`,
      rpe: set.rpe === null ? null : `@${fmtWeight(set.rpe)}`,
      warmup: kind === "warmup",
      failure: kind === "failure",
    });
    group.last = set;
  }

  return [...groups.values()];
}

// --------------------------------------------------------------- the stats

export interface WorkoutStats {
  /** Working sets. Warmups are not stimulus and are not counted. */
  sets: number;
  /** `21,450`. Working sets only, the same rule `totalVolumeKg` follows. */
  volumeLb: string;
  /** `58 min`, or null for a workout with no recorded end. */
  duration: string | null;
  /** `Chest 6 · Triceps 4.5 · Front Delts 3`, the top three. Null when nothing maps. */
  muscles: string | null;
}

const MUSCLE_SUMMARY_LIMIT = 3;

/**
 * The stat row under the title.
 *
 * Muscles come from `bootstrap.catalogue`, which the phone already holds, so
 * the GET does not have to carry a muscle map per set. A lift missing from the
 * catalogue (created on another device since the last bootstrap) simply
 * counts toward nothing until the next refetch.
 */
export function workoutStats(detail: WorkoutDetail, catalogue: CatalogueExercise[]): WorkoutStats {
  const working = detail.sets.filter((s) => !s.isWarmup);
  const volume = Math.round(working.reduce((sum, s) => sum + s.weightLb * s.reps, 0));

  const byId = new Map(catalogue.map((e) => [e.id, e]));
  const counted: CountedSet[] = detail.sets.map((s) => ({
    isWarmup: s.isWarmup,
    muscles: (byId.get(s.exerciseId)?.muscles ?? []).map((m) => ({
      // The catalogue sends the enum as a string; `hardSetsByMuscle` only keys
      // a map by it, and `muscleLabel` is guarded below for an unknown value.
      muscle: m.muscle as CountedSet["muscles"][number]["muscle"],
      contribution: m.contribution,
    })),
  }));
  const ranked = [...hardSetsByMuscle(counted).entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MUSCLE_SUMMARY_LIMIT)
    .map(([m, v]) => `${muscleLabel(m) ?? m} ${fmtWeight(v)}`);

  return {
    sets: working.length,
    volumeLb: volume.toLocaleString("en-US"),
    duration: detail.durationMin === null ? null : `${detail.durationMin} min`,
    muscles: ranked.length === 0 ? null : ranked.join(" · "),
  };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `Tue, Oct 21 · 58 min`.
 *
 * From `localDate`, read as a calendar date in UTC so no device timezone can
 * move it a day — the date is the one the server filed it under, which is the
 * one the owner trained on.
 */
export function workoutSubtitle(detail: WorkoutDetail): string {
  const d = new Date(`${detail.localDate}T00:00:00Z`);
  const date = Number.isNaN(d.getTime())
    ? detail.localDate
    : `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return detail.durationMin === null ? date : `${date} · ${detail.durationMin} min`;
}

// --------------------------------------------------------- the edit sheet

/**
 * A server set as the shape `EditSetSheet` edits.
 *
 * The sheet was built for the live session, where a set may still be only on
 * the phone; here every set is delivered, so `id` is the row's and `queued` is
 * false. `clientId` is unused by this screen and carries the id so nothing
 * that keys on it can collide.
 */
export function displaySetFor(set: WorkoutDetailSet): DisplaySet {
  return {
    key: set.id,
    id: set.id,
    clientId: set.id,
    queued: false,
    exerciseId: set.exerciseId,
    reps: set.reps,
    weightLb: set.weightLb,
    rpe: set.rpe,
    toFailure: set.toFailure,
    isWarmup: set.isWarmup,
    felt: set.felt,
    loggedAt: set.loggedAt,
  };
}

/**
 * What "+ Add set" opens with.
 *
 * The last set of that lift in this workout, because the next set is almost
 * always the same weight and reps — the third set of 185×5 follows the second.
 * Its RPE is copied too, and its kind, except that a set to failure becomes a
 * working set: failure is how a set ended, not a property to repeat.
 *
 * For a lift new to this workout ("+ Add exercise"), the modal set from the
 * last time it was trained (`bootstrap.lastSets`), with no RPE — that was a
 * different day. With neither, an empty bar and a typical rep count; the pad
 * is one tap away either way.
 */
export const BLANK_PREFILL: SetEdit = { weightLb: 0, reps: 8, rpe: null, kind: "working" };

export function addPrefill(
  lastHere: WorkoutDetailSet | null,
  lastEver: LastSet | undefined,
): SetEdit {
  if (lastHere !== null) {
    const kind = setKindOf(lastHere);
    return {
      weightLb: lastHere.weightLb,
      reps: lastHere.reps,
      rpe: lastHere.rpe,
      kind: kind === "failure" ? "working" : kind,
    };
  }
  if (lastEver !== undefined) {
    return { weightLb: lastEver.weightLb, reps: lastEver.reps, rpe: null, kind: "working" };
  }
  return BLANK_PREFILL;
}

/**
 * The sheet's "set" in add mode: the prefill, dressed as a set with no id.
 *
 * `key` changes per open so the sheet re-seeds even when the same lift is
 * added to twice in a row — it seeds on the key, see `EditSetSheet`.
 */
export function addDraftSet(exerciseId: string, prefill: SetEdit, nonce: number): DisplaySet {
  return {
    key: `add:${exerciseId}:${nonce}`,
    id: null,
    clientId: `add:${exerciseId}:${nonce}`,
    queued: false,
    exerciseId,
    reps: prefill.reps,
    weightLb: prefill.weightLb,
    rpe: prefill.rpe,
    ...kindFlags(prefill.kind),
    felt: null,
    loggedAt: "",
  };
}

/** The POST body for a fixed set (`setId`) or a new one (no `setId`). */
export function setWritePayload(
  workoutId: string,
  exerciseId: string,
  edit: SetEdit,
  setId?: string,
): WorkoutSetWrite {
  return {
    workoutId,
    ...(setId !== undefined ? { id: setId } : {}),
    exerciseId,
    reps: edit.reps,
    weightLb: edit.weightLb,
    rpe: edit.rpe,
    // Both flags, always — the rule `lib/set-kind.ts` exists for.
    ...kindFlags(edit.kind),
  };
}

// ---------------------------------------------------------------- copy

export const OFFLINE_MESSAGE = "No signal. Changes to past workouts need a connection.";
export const ONLY_SET_WARNING = "This is the workout's only set. Removing it deletes the workout.";
export const DELETED_NOTICE = "Workout deleted.";

/**
 * What a failed write says in its sheet.
 *
 * Status 0 is `ApiError`'s "never reached the server" — no signal, a timeout,
 * DNS — and gets the one sentence that says why and what to do. Past-workout
 * edits do not queue: the outbox is the live session's pipe, and a correction
 * to last Tuesday can wait for a bar of signal. Anything the server answered
 * shows the server's own message, which says what was wrong with the figure.
 */
export function writeErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null && "status" in err && (err as { status: unknown }).status === 0) {
    return OFFLINE_MESSAGE;
  }
  return err instanceof Error && err.message !== "" ? err.message : fallback;
}

/** The remove button's warning, when removing this set would take the workout with it. */
export function removeWarning(detail: WorkoutDetail): string | null {
  return detail.sets.length === 1 ? ONLY_SET_WARNING : null;
}

/** What `deleteWorkoutPrompt` needs from this screen: how many working sets go. */
export const workingSetCount = (detail: WorkoutDetail): number =>
  detail.sets.filter((s) => !s.isWarmup).length;

// --------------------------------------------------------------- states

export type ScreenState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "live" }
  | { kind: "ready"; detail: WorkoutDetail };

/**
 * Which of the screen's states to draw.
 *
 * A 404 is its own state rather than an error line: it is the normal result of
 * opening a workout that was just deleted (from here, from the web app, or by
 * removing its last set), and it deserves a sentence and a way back. The live
 * session is shown as a pointer to Lift, never as editors — two writers on a
 * running session is exactly what the server refuses.
 */
export function screenState(q: {
  data: WorkoutDetail | undefined;
  error: unknown;
  isLoading: boolean;
}): ScreenState {
  if (q.data !== undefined) return q.data.live ? { kind: "live" } : { kind: "ready", detail: q.data };
  if (q.error) {
    const status = typeof q.error === "object" && q.error !== null && "status" in q.error
      ? (q.error as { status: unknown }).status
      : null;
    if (status === 404) return { kind: "missing" };
    // The request's own message, not OFFLINE_MESSAGE: that sentence is about
    // saving changes, and this is a read that failed.
    const message = q.error instanceof Error && q.error.message !== ""
      ? q.error.message
      : "Could not load this workout.";
    return { kind: "error", message };
  }
  return { kind: "loading" };
}

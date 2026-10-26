import { displayLb } from "./domain/units";
import type { Muscle } from "@/db/schema";
import type { CountedSet } from "./domain/muscles";
import { SANITY, setWithinSanity } from "./llm/shorthand";

/**
 * Editing a workout that is over.
 *
 * ── WHY THIS IS NOT `POST /api/sets` ───────────────────────────────────────
 *
 * The live session already has a write path, and it is deliberately narrow:
 * `/api/sets` picks its workout by WHEN the set was logged (`workoutForSetAt`),
 * and a correction is a re-POST of the same `clientId` so it can ride the
 * outbox through a basement. Teaching that route to accept "this completed
 * workout, by id" would loosen exactly the guarantee it exists to give — that
 * a set lands in the session it was logged in and nowhere else.
 *
 * So last Tuesday's workout gets its own route, `/api/mobile/workout/set`, and
 * its decisions live here where they can be tested without a database:
 *
 *  - what a write body must look like (`parseSetWrite`, `parseSetDelete`),
 *  - which workouts may be edited at all (`editableReason`),
 *  - where an added set goes in the timeline (`nextSetPosition`),
 *  - and the wire shape of a whole workout (`workoutDetail`).
 *
 * Kept free of `@/db` for the reason `recent-workouts.ts` is: `queries.ts`
 * opens a connection at import.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

// ------------------------------------------------------------- the bodies

export interface SetWrite {
  workoutId: string;
  /** Present: an UPDATE of that row. Absent: a new set. */
  id?: string;
  /** Required for a new set. Ignored on an update — a set never changes lift. */
  exerciseId?: string;
  reps: number;
  weightLb: number;
  /** `undefined` on an update means "leave it"; `null` means "clear it". */
  rpe?: number | null;
  toFailure?: boolean;
  isWarmup?: boolean;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/**
 * A write body, checked field by field.
 *
 * The SANITY bound is the same one `/api/sets` enforces and for the same
 * reason: one 165-rep set becomes a ~2000 lb e1RM that is the all-time peak of
 * every chart that lift appears on. It is refused, not clamped — storing a
 * different figure from the one the owner typed is how a logger loses trust.
 */
export function parseSetWrite(raw: unknown): Parsed<SetWrite> {
  if (typeof raw !== "object" || raw === null) return fail("Send a set.");
  const b = raw as Record<string, unknown>;

  if (!isUuid(b.workoutId)) return fail("workoutId must be a uuid.");
  if (b.id !== undefined && !isUuid(b.id)) return fail("id must be a uuid.");
  if (b.id === undefined && !isUuid(b.exerciseId)) return fail("exerciseId must be a uuid.");
  if (b.exerciseId !== undefined && !isUuid(b.exerciseId)) return fail("exerciseId must be a uuid.");

  const reps = b.reps;
  const weightLb = b.weightLb;
  if (typeof reps !== "number" || typeof weightLb !== "number" || !setWithinSanity(reps, weightLb)) {
    return fail(`A set must be ${SANITY.minReps}–${SANITY.maxReps} reps at 0–${SANITY.maxWeightLb} lb.`);
  }

  if (b.rpe !== undefined && b.rpe !== null) {
    if (typeof b.rpe !== "number" || !Number.isFinite(b.rpe) || b.rpe < 1 || b.rpe > 10) {
      return fail("rpe must be between 1 and 10.");
    }
  }
  for (const flag of ["toFailure", "isWarmup"] as const) {
    if (b[flag] !== undefined && typeof b[flag] !== "boolean") return fail(`${flag} must be true or false.`);
  }

  return {
    ok: true,
    value: {
      workoutId: b.workoutId,
      ...(b.id !== undefined ? { id: b.id as string } : {}),
      ...(b.exerciseId !== undefined ? { exerciseId: b.exerciseId as string } : {}),
      reps,
      weightLb,
      ...(b.rpe !== undefined ? { rpe: b.rpe as number | null } : {}),
      ...(b.toFailure !== undefined ? { toFailure: b.toFailure as boolean } : {}),
      ...(b.isWarmup !== undefined ? { isWarmup: b.isWarmup as boolean } : {}),
    },
  };
}

export function parseSetDelete(raw: unknown): Parsed<{ workoutId: string; id: string }> {
  if (typeof raw !== "object" || raw === null) return fail("Send a set.");
  const b = raw as Record<string, unknown>;
  if (!isUuid(b.workoutId)) return fail("workoutId must be a uuid.");
  if (!isUuid(b.id)) return fail("id must be a uuid.");
  return { ok: true, value: { workoutId: b.workoutId, id: b.id } };
}

// --------------------------------------------------------- the refusals

export interface Refusal {
  status: 404 | 409;
  message: string;
}

export const LIVE_SESSION_MESSAGE = "That session is still running. Edit it from Lift.";

/**
 * Whether this workout may be edited from the past-workout screen, or why not.
 *
 * `workout` is the row as read SCOPED TO THE USER, so `null` covers both "no
 * such workout" and "someone else's" — the same 404 either way, which is the
 * point: the answer must not reveal that another user's id exists.
 *
 * The live session is refused because it already has a writer. The outbox
 * upserts its sets on `(workout_id, client_id)` and may be holding some right
 * now; a second path inserting rows with no `client_id` alongside it would put
 * two writers on one session, and the position arithmetic here would race the
 * one in `/api/sets`. Edit it from Lift, where the queue is.
 *
 * Anything else that is not `completed` is refused too. An `abandoned` row is
 * an empty session STOP threw away, and an `active` one that has merely gone
 * idle is closed by the next write path that runs `closeStaleSession` — after
 * which it is a completed workout and editable. Writing into either state here
 * would resurrect something the session lifecycle already decided about.
 */
export function editableReason(
  workout: { id: string; status: string } | null,
  liveId: string | null,
): Refusal | null {
  if (workout === null) return { status: 404, message: "Unknown workout." };
  if (workout.id === liveId) return { status: 409, message: LIVE_SESSION_MESSAGE };
  if (workout.status !== "completed") {
    return { status: 409, message: "Only finished workouts can be edited here." };
  }
  return null;
}

// --------------------------------------------------------- the position

/**
 * Where a set added after the fact goes: after every set already there.
 *
 * `setIndex` is one past the highest — the same rule `/api/sets` follows — and
 * `loggedAt` one second past the latest, so the new set sorts last in every
 * view that orders by time (they all do) without claiming to have happened an
 * hour after the session ended. An empty workout cannot reach here in practice
 * (deleting its last set deletes it), but if one did, its start is the only
 * honest anchor.
 *
 * `restS` is not computed: there was no rest measured for a set typed in days
 * later, and inventing one would feed the progression rules a number nobody
 * observed.
 */
export function nextSetPosition(
  rows: { setIndex: number; loggedAt: Date }[],
  startedAt: Date,
): { setIndex: number; loggedAt: Date } {
  if (rows.length === 0) return { setIndex: 1, loggedAt: new Date(startedAt.getTime()) };
  const setIndex = Math.max(...rows.map((r) => r.setIndex)) + 1;
  const latest = Math.max(...rows.map((r) => r.loggedAt.getTime()));
  return { setIndex, loggedAt: new Date(latest + 1000) };
}

/**
 * The joined set × muscle rows a workout name is derived from, as `CountedSet`s.
 *
 * Same shape `session/stop` builds, so a workout renamed here reads exactly as
 * it would have had the set been logged live.
 */
export function countedSets(
  rows: { isWarmup: boolean; muscle: string | null; contribution: number | null }[],
): CountedSet[] {
  return rows
    .filter((r) => r.muscle !== null && r.contribution !== null)
    .map((r) => ({
      isWarmup: r.isWarmup,
      muscles: [{ muscle: r.muscle as Muscle, contribution: r.contribution as number }],
    }));
}

// ------------------------------------------------------------- the wire

export interface WorkoutSetRow {
  id: string;
  exerciseId: string;
  exerciseName: string;
  setIndex: number;
  reps: number;
  weightKg: number;
  rpe: number | null;
  toFailure: boolean;
  isWarmup: boolean;
  felt: "weak" | "normal" | "strong" | null;
  note: string;
  loggedAt: Date;
}

export interface WorkoutDetailSet {
  id: string;
  exerciseId: string;
  exerciseName: string;
  setIndex: number;
  reps: number;
  weightLb: number;
  rpe: number | null;
  toFailure: boolean;
  isWarmup: boolean;
  felt: "weak" | "normal" | "strong" | null;
  note: string;
  loggedAt: string;
}

export interface WorkoutDetail {
  id: string;
  name: string;
  nameIsCustom: boolean;
  localDate: string;
  startedAt: string;
  endedAt: string | null;
  /** Null for a workout that never recorded an end. */
  durationMin: number | null;
  status: string;
  /** The session running right now. The phone shows "open Lift" instead of editors. */
  live: boolean;
  /** In logged order. */
  sets: WorkoutDetailSet[];
}

/**
 * One workout, every set, in lb. Primitives only — see `api/mobile/shared.ts`.
 */
export function workoutDetail(
  workout: {
    id: string;
    name: string;
    nameIsCustom: boolean;
    localDate: string;
    startedAt: Date;
    endedAt: Date | null;
    status: string;
  },
  rows: WorkoutSetRow[],
  liveId: string | null,
): WorkoutDetail {
  return {
    id: workout.id,
    name: workout.name,
    nameIsCustom: workout.nameIsCustom,
    localDate: workout.localDate,
    startedAt: workout.startedAt.toISOString(),
    endedAt: workout.endedAt === null ? null : workout.endedAt.toISOString(),
    durationMin: workout.endedAt === null
      ? null
      : Math.max(0, Math.round((+workout.endedAt - +workout.startedAt) / 60_000)),
    status: workout.status,
    live: workout.id === liveId,
    sets: [...rows]
      .sort((a, b) => +a.loggedAt - +b.loggedAt)
      .map((r) => ({
        id: r.id,
        exerciseId: r.exerciseId,
        exerciseName: r.exerciseName,
        setIndex: r.setIndex,
        reps: r.reps,
        weightLb: displayLb(r.weightKg),
        rpe: r.rpe,
        toFailure: r.toFailure,
        isWarmup: r.isWarmup,
        felt: r.felt,
        note: r.note,
        loggedAt: r.loggedAt.toISOString(),
      })),
  };
}

import { route } from "@/lib/api";
import { db } from "@/db";
import { sets, workouts } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { lbToKg } from "@/lib/domain/units";
import { getActiveWorkout } from "@/lib/queries";

interface Body {
  exerciseId: string;
  reps: number;
  weightLb: number;
  rpe?: number | null;
  toFailure?: boolean;
  isWarmup?: boolean;
  felt?: "weak" | "normal" | "strong" | null;
  note?: string;
  rawText?: string;
  /** Minted by the outbox before the first attempt. See drizzle/0003. */
  clientId?: string;
  /** When the set was actually logged, which is not when it arrived. */
  loggedAt?: string;
}

/** Longest gap that can still be called "rest" rather than "went home". */
const MAX_REST_S = 3600;

export const POST = route<Body>(async ({ userId, body }) => {
  const active = await getActiveWorkout(userId);
  if (!active) throw new Error("Start a session first.");

  // The phone stamps this. A set logged at 6:12pm in a basement and delivered
  // at 7:04pm in the car park happened at 6:12 — using arrival time would put
  // the whole session's timeline, and every rest gap in it, in the wrong place.
  const loggedAt = parseLoggedAt(body.loggedAt, active.startedAt);

  const prior = await db.select({ loggedAt: sets.loggedAt, setIndex: sets.setIndex })
    .from(sets).where(eq(sets.workoutId, active.id))
    .orderBy(desc(sets.loggedAt)).limit(1);

  // Rest is measured from the gap since the last save. Free data — the user is
  // already tapping — and it feeds whether the next set should go up.
  const gapS = prior.length
    ? Math.round((loggedAt.getTime() - prior[0].loggedAt.getTime()) / 1000)
    : null;
  const restS = gapS !== null && gapS >= 0 ? Math.min(MAX_REST_S, gapS) : null;

  const values = {
    workoutId: active.id,
    exerciseId: body.exerciseId,
    setIndex: (prior[0]?.setIndex ?? 0) + 1,
    reps: body.reps,
    weightKg: lbToKg(body.weightLb),
    rpe: body.rpe ?? null,
    toFailure: body.toFailure ?? false,
    isWarmup: body.isWarmup ?? false,
    restS,
    felt: body.felt ?? null,
    note: body.note ?? "",
    rawText: body.rawText ?? "",
    clientId: body.clientId ?? null,
    loggedAt,
  };

  // A retry after a lost response carries the same clientId, so it lands on the
  // row it already wrote instead of creating a second one. Without a clientId
  // there is nothing to match on and it inserts, which is the old behaviour and
  // the right one for a caller that is not the outbox.
  const [row] = body.clientId
    ? await db.insert(sets).values(values).onConflictDoUpdate({
      target: [sets.workoutId, sets.clientId],
      // set_index is left alone: the first delivery already claimed a position
      // in the session, and recomputing it on a retry would renumber the set.
      set: {
        reps: values.reps, weightKg: values.weightKg, rpe: values.rpe,
        toFailure: values.toFailure, isWarmup: values.isWarmup, felt: values.felt,
        note: values.note, rawText: values.rawText,
      },
    }).returning()
    : await db.insert(sets).values(values).returning();

  return { set: row };
});

/**
 * Trusts the phone's clock, within reason.
 *
 * A single-user app has no reason to police this hard, but a clock that is
 * wrong by a year would put the set outside the session and out of every
 * rollup. Anything before the session started or in the future falls back to
 * now, which is what the server would have used anyway.
 */
function parseLoggedAt(raw: string | undefined, sessionStart: Date): Date {
  if (!raw) return new Date();
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return new Date();
  if (at.getTime() < sessionStart.getTime()) return new Date();
  if (at.getTime() > Date.now() + 60_000) return new Date();
  return at;
}

export const DELETE = route<{ id: string }>(async ({ userId, body }) => {
  const active = await getActiveWorkout(userId);
  if (!active) throw new Error("No active session.");
  await db.delete(sets).where(and(eq(sets.id, body.id), eq(sets.workoutId, active.id)));
  return { ok: true };
});

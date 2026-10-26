import { route, HttpError } from "@/lib/api";
import { db } from "@/db";
import { sets, workouts } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { lbToKg } from "@/lib/domain/units";
import { getActiveWorkout } from "@/lib/queries";
import { SANITY, setWithinSanity } from "@/lib/llm/shorthand";

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
  /*
   * The bound lives here because this is the only place every client passes
   * through — the web SetLogger, the phone's outbox, the confirmation sheet and
   * the voice path all end up at this route. Before this, none of them was
   * checked server-side: the deterministic parser enforced SANITY, and nothing
   * else did, so a set of 165 reps at 165 lb was still writable by anything
   * that skipped the parser (a model answer, a hand-rolled request, the web
   * logger's own inputs). One bad row is not a cosmetic problem — Epley makes
   * it a ~2000 lb e1RM that becomes the all-time peak and rescales the
   * exercise's whole trend chart.
   *
   * 400 rather than a clamp: silently storing a different number than the one
   * sent is how a logger loses trust, and every caller here has a human in
   * front of it who can fix the figure.
   */
  if (!setWithinSanity(body.reps, body.weightLb)) {
    throw new HttpError(
      `A set must be ${SANITY.minReps}–${SANITY.maxReps} reps at 0–${SANITY.maxWeightLb} lb.`,
    );
  }

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

  /*
   * What a second write of the same set is allowed to change.
   *
   * `reps` and `weightLb` are required on the body, so they are always written.
   * EVERYTHING ELSE is written only when the body actually provides it, and
   * left exactly as it was when the body omits it.
   *
   * That rule is for the phone's fix-a-set sheet. There is no PATCH route — a
   * correction is a re-POST of the same `clientId`, which is what lets it go
   * through the outbox and therefore work in a basement. But the phone's
   * session payload carries the figures a chip draws and NOT the set note or
   * the raw text of what was dictated, so a correction built from what the
   * phone knows would have sent `note: ""` and wiped a sentence the owner
   * typed. Omitting a field is now how a caller says "leave this alone".
   *
   * It changes nothing for a retry, which re-sends the identical payload it was
   * minted with, and nothing for the web logger, which sends every field.
   */
  const correction = {
    reps: values.reps,
    weightKg: values.weightKg,
    ...(body.rpe !== undefined ? { rpe: values.rpe } : {}),
    ...(body.toFailure !== undefined ? { toFailure: values.toFailure } : {}),
    ...(body.isWarmup !== undefined ? { isWarmup: values.isWarmup } : {}),
    ...(body.felt !== undefined ? { felt: values.felt } : {}),
    ...(body.note !== undefined ? { note: values.note } : {}),
    ...(body.rawText !== undefined ? { rawText: values.rawText } : {}),
  };

  // A retry after a lost response carries the same clientId, so it lands on the
  // row it already wrote instead of creating a second one. Without a clientId
  // there is nothing to match on and it inserts, which is the old behaviour and
  // the right one for a caller that is not the outbox.
  const [row] = body.clientId
    ? await db.insert(sets).values(values).onConflictDoUpdate({
      target: [sets.workoutId, sets.clientId],
      // set_index and rest_s are left alone: the first delivery already claimed
      // a position in the session and measured the gap before it, and
      // recomputing either on a retry — or on a correction made an hour later —
      // would renumber the set and record an hour of rest in front of it.
      set: correction,
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

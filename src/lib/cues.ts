import { db } from "@/db";
import { exerciseCues } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Per-exercise coaching cues: "elbows tucked, pause on chest", pinned to
 * Barbell Bench Press, shown every time that lift is logged.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 *
 * `sets.note` already exists, and it is the other thing: one line about one
 * set, in one session, which scrolls away behind you. The owner asked for
 * somewhere to put notes "per exercise", and chose carry-forward — so a cue is
 * written once and never has to be written again. The two coexist: the note is
 * what happened, the cue is what to remember.
 *
 * ── WHERE IT TRAVELS ───────────────────────────────────────────────────────
 *
 * Reads ride `GET /api/mobile/bootstrap`, as a flat `cues` map, for the same
 * reason `lastSets` does: the cue has to be on screen in a basement with no
 * signal, and the phone gets one round trip on the way in. It is the cheapest
 * read in that payload — one predicate on the leading column of the primary
 * key, returning as many rows as the user has bothered to write cues for, and
 * measured at 0.022 ms against the local Postgres with RLS on.
 * `GET /api/mobile/exercise?id=` carries the one cue as well, so the detail
 * screen can show and edit it without consulting a payload it did not fetch.
 *
 * Writes go through `POST /api/mobile/exercise/cue`, which is this module's
 * `setCue`.
 */

/**
 * Longest cue worth storing, and the number is measured rather than chosen.
 *
 * A cue is read in the confirmation sheet with a number pad on screen. At
 * phone width that content column fits roughly 40 characters a line, so 240 is
 * about six lines — as much as can sit above the pad without pushing it off
 * the screen. Past this it is a training log entry rather than a cue, and
 * nothing reads one of those between sets.
 *
 * `drizzle/0005` carries the same ceiling as a CHECK constraint, so a caller
 * that skips this module cannot store a cue the UI cannot render.
 */
export const MAX_CUE_LENGTH = 240;

/**
 * Trim the ends, keep the shape.
 *
 * Deliberately NOT the whitespace collapsing `normalise()` in
 * src/lib/exercises.ts does. A cue is prose the owner wrote for themselves and
 * line breaks are how they will separate two cues on one lift — "elbows
 * tucked" above "pause on chest". Collapsing those into one run-on line would
 * throw away the only formatting the field has.
 *
 * So: CRLF to LF so a cue pasted from a desktop does not arrive with a
 * carriage return on every line, trailing spaces off each line, any run of
 * blank lines down to a single one, and the whole thing trimmed. (The regex
 * counts NEWLINES, not blank lines: `\n{3,}` is two or more blank lines, and
 * it leaves exactly one.) That is exactly the
 * shape `exercise_cues_cue_shape` in drizzle/0005 will accept.
 *
 * Returns `""` for a cue that is only whitespace, which is how the caller is
 * told to delete the row rather than store one.
 */
export function normaliseCue(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Every cue this user has, keyed by exercise id.
 *
 * A plain object rather than a Map because it goes over the wire as JSON and
 * the phone indexes it by the exercise id it already holds. Exercises with no
 * cue are ABSENT, not present as `""` — the same rule `lastSets` follows, so
 * `cues[id]` being undefined is the single answer to "is there a cue here".
 *
 * Scoped by `user_id` in the predicate as well as by RLS, so the visibility
 * rule is readable at the call site and not only in drizzle/0005.
 */
export async function getCues(userId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ exerciseId: exerciseCues.exerciseId, cue: exerciseCues.cue })
    .from(exerciseCues)
    .where(eq(exerciseCues.userId, userId));

  const out: Record<string, string> = {};
  for (const row of rows) out[row.exerciseId] = row.cue;
  return out;
}

/** One cue, or null when this lift has none. */
export async function getCue(userId: string, exerciseId: string): Promise<string | null> {
  const [row] = await db
    .select({ cue: exerciseCues.cue })
    .from(exerciseCues)
    .where(and(eq(exerciseCues.userId, userId), eq(exerciseCues.exerciseId, exerciseId)))
    .limit(1);

  return row?.cue ?? null;
}

/**
 * Write, replace or clear this user's cue for one lift.
 *
 * Returns the cue as stored, or null when the text was empty and the row was
 * deleted. The caller echoes that back rather than echoing what it was sent,
 * so the client renders what the database actually holds after normalisation.
 *
 * ── CLEARING IS A DELETE, NOT AN EMPTY STRING ──────────────────────────────
 *
 * There is one representation of "no cue" and it is the absence of a row. An
 * empty string would be a second, and every consumer would then need to know
 * that `cues[id] === ""` renders as nothing while `cues[id] === undefined`
 * renders as nothing for a different reason. `exercise_cues_cue_shape` in
 * drizzle/0005 refuses the empty string outright, so this is the database's
 * rule rather than this function's convention.
 *
 * ── IDEMPOTENT, SO IT CAN BE RETRIED OR QUEUED ─────────────────────────────
 *
 * `onConflictDoUpdate` on the composite primary key makes a repeat write
 * last-write-wins. Saving the same cue twice — a double-tapped save, a retry
 * after a response was lost on a dying bar of signal, the outbox replaying a
 * queued item — lands on one row with no duplicate and no conflict to report.
 * That is what makes this safe to enqueue offline alongside a set.
 *
 * Must be called inside `withUser()`: the WITH CHECK on `own_exercise_cues`
 * requires the exercise to be visible to the writer, and outside a scope `db`
 * falls back to the RLS-bypassing admin handle. `route()` provides the scope.
 */
export async function setCue(
  userId: string,
  exerciseId: string,
  raw: string,
): Promise<string | null> {
  const cue = normaliseCue(raw);

  if (cue === "") {
    await db.delete(exerciseCues).where(and(
      eq(exerciseCues.userId, userId),
      eq(exerciseCues.exerciseId, exerciseId),
    ));
    return null;
  }

  if (cue.length > MAX_CUE_LENGTH) {
    // Truncating silently would hand back a cue missing its last word with no
    // indication of why. The route turns this into a 400 that names the limit.
    throw new Error(`A cue must be ${MAX_CUE_LENGTH} characters or fewer.`);
  }

  const [row] = await db.insert(exerciseCues)
    .values({ userId, exerciseId, cue })
    .onConflictDoUpdate({
      target: [exerciseCues.userId, exerciseCues.exerciseId],
      set: { cue, updatedAt: new Date() },
    })
    .returning({ cue: exerciseCues.cue });

  return row.cue;
}

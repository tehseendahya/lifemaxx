import { route, HttpError } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { db } from "@/db";
import { exercises } from "@/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { setCue, normaliseCue, MAX_CUE_LENGTH } from "@/lib/cues";
import { requireUuid } from "../../shared";

/**
 * Pin a cue to a lift, change it, or take it off.
 *
 * "Elbows tucked, pause on chest" on Barbell Bench Press, written once and
 * shown every time that lift is logged from then on. The owner asked for
 * somewhere to put notes per exercise; this is the write end of it. Reads come
 * down with `bootstrap` and with `GET /api/mobile/exercise?id=`, so the phone
 * already holds every cue before it is in the gym.
 *
 * ── ONE VERB, THREE OUTCOMES ───────────────────────────────────────────────
 *
 * Writing, replacing and clearing are all this one call. `cue: ""` deletes the
 * row, which is the only representation of "no cue" there is — see
 * `setCue()`. A separate DELETE would mean a second route, a second
 * client-side error path, and a client that has to decide which of the two to
 * call from a text field whose value it is about to send either way.
 *
 * ── SAFE TO SEND TWICE ─────────────────────────────────────────────────────
 *
 * The write upserts on (user_id, exercise_id), so a double-tapped save, a
 * retry after a lost response, or the outbox replaying a queued item all land
 * on one row, last write winning. POST rather than PUT for the same reason
 * every other mobile write is a POST: the outbox's sender only speaks POST, so
 * this stays enqueueable without touching it.
 *
 * ── WHY THE VISIBILITY CHECK IS HERE AS WELL AS IN THE POLICY ──────────────
 *
 * `own_exercise_cues` in drizzle/0005 has
 * `WITH CHECK (user_id = me AND EXISTS (SELECT 1 FROM exercises WHERE id = ...))`,
 * so the database already refuses a cue pinned to a lift this user cannot see
 * — which is what stops a guessed uuid from attaching a cue to somebody else's
 * custom exercise. What the database cannot do is say *why*: a policy
 * violation reaches `route()` as a 500. The lookup below turns it into a 404
 * that names the problem, exactly as `POST /api/mobile/exercise/alias` does
 * for the same reason.
 */

interface Body {
  exerciseId?: string;
  /** The cue as typed. Empty, or only whitespace, removes it. */
  cue?: string;
}

export const POST = route<Body>(async ({ userId, body }) => {
  const exerciseId = requireUuid(body.exerciseId ?? null, "exerciseId");

  if (body.cue !== undefined && typeof body.cue !== "string") {
    throw new HttpError("cue must be a string.");
  }

  // Normalised before it is measured, not after. The ceiling is on what gets
  // stored, and a cue pasted with a trailing newline or trailing spaces on
  // every line would otherwise be rejected for characters that were never
  // going to be written.
  const cue = normaliseCue(body.cue ?? "");
  if (cue.length > MAX_CUE_LENGTH) {
    throw new HttpError(`cue must be ${MAX_CUE_LENGTH} characters or fewer.`);
  }

  // RLS already restricts this to the catalogue plus the user's own rows (see
  // read_catalogue_and_own_exercises in drizzle/0001). The predicate is here
  // anyway so the visibility rule is readable at the call site.
  const [visible] = await db.select({ id: exercises.id })
    .from(exercises)
    .where(and(
      eq(exercises.id, exerciseId),
      or(isNull(exercises.userId), eq(exercises.userId, userId)),
    ))
    .limit(1);

  if (!visible) throw new HttpError("Unknown exercise.", 404);

  /*
   * The stored cue, echoed back — not the text that was sent.
   *
   * Normalisation happens on the way in, so the two are not always the same
   * string, and a client that rendered its own input would show a cue that
   * differs from the one it will receive in the next bootstrap. Null when the
   * cue was cleared.
   */
  return { exerciseId, cue: await setCue(userId, exerciseId, cue) };
});

export const OPTIONS = preflight;

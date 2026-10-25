import { route, HttpError } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { displayLb } from "@/lib/domain/units";
import {
  createUserExercise,
  musclesFor,
  resolveExerciseOutcome,
  MAX_EXERCISE_NAME,
  type ResolvedExercise,
} from "@/lib/exercises";

/**
 * Add an exercise the catalogue does not have.
 *
 * This is the end of the dead end. The owner pasted "preacher curls", got an
 * unmatched chip, tapped it, searched the picker, found nothing — and there was
 * no way forward anywhere in the app, even though the schema has supported
 * user-owned exercises since it was written.
 *
 * ── THE DECISION THIS IMPLEMENTS ───────────────────────────────────────────
 *
 * Auto-create, but flag near misses. Three outcomes, and the client needs no
 * rules of its own to tell them apart:
 *
 *   `created: true`                      a new row, owned by this user.
 *   `created: false, reason: "exists"`    it already resolved; here it is.
 *   `created: false, reason: "near_miss"` something very close exists. The
 *                                        client asks, then calls back with
 *                                        `force: true` to create anyway.
 *
 * All three are 200. A near miss is a question, not a failure — returning 409
 * would make every client's error path responsible for telling a conflict from
 * a question, and the one that got it wrong would show the owner a red banner
 * for a lift that is simply new.
 *
 * `"exists"` is what makes this safe to call twice. The create button can be
 * double-tapped, the request can be retried after a timeout that actually
 * succeeded, and both land on the row the first call wrote — because that call
 * also learned the typed wording as an alias, so the second resolves exactly.
 *
 * POST and not part of the outbox, deliberately: the client cannot log a set
 * until it has the new exercise's id, so this has to be a round trip with an
 * answer rather than a queued write. Sets logged against it afterwards go
 * through the outbox as usual.
 */

interface Body {
  /** Exactly what the user typed. Learned as an alias, whatever it looks like. */
  name?: string;
  /** Set after the user has answered a `near_miss` question with "no, it's new". */
  force?: boolean;
}

/**
 * The shape of one row in `bootstrap`'s catalogue, so the phone can drop the
 * answer straight into the list it already has and pick it in the same breath.
 * Pounds at the edge, like every other `/api/mobile` route.
 */
async function dto(exercise: ResolvedExercise) {
  const muscles = (await musclesFor([exercise.id])).get(exercise.id) ?? [];
  return {
    id: exercise.id,
    name: exercise.name,
    slug: exercise.slug,
    incrementLb: displayLb(exercise.incrementKg),
    equipment: exercise.equipment,
    muscles,
  };
}

export const POST = route<Body>(async ({ userId, body }) => {
  const typed = (body.name ?? "").trim();
  if (typed === "") throw new HttpError("name is required.");
  if (typed.length > MAX_EXERCISE_NAME) {
    throw new HttpError(`name must be under ${MAX_EXERCISE_NAME} characters.`);
  }
  // A name of digits and punctuation is a mis-parse of a set, not a lift. It
  // would slugify to nothing and produce a row called "123" that the user can
  // never find again.
  if (!/\p{L}/u.test(typed)) throw new HttpError("name must contain a letter.");

  const outcome = await resolveExerciseOutcome(typed, userId);

  /*
   * ONLY AN EXACT ALIAS COUNTS AS "YOU ALREADY HAVE THIS".
   *
   * Everywhere else in the app a fuzzy match is good enough to act on. Here it
   * is not, and the difference is who is asking. Reaching this route means the
   * user has typed a name, looked at a list of what matched it, and pressed
   * add anyway — they have already rejected the near things. Handing back a
   * fuzzy match would answer a different question than the one asked and would
   * reproduce, in the one screen built to fix it, exactly the complaint that
   * started this round: a confident wrong match with no way to override it.
   *
   * Measured, this is not hypothetical. "gronk preacher curl" fuzzy-matches the
   * catalogue's Preacher Curl, and "jm press" fuzzy-matches Overhead Press. So
   * a fuzzy match is demoted to the same question a near miss gets, and `force`
   * answers both.
   *
   * Idempotency survives it: creating also learns the typed wording as an
   * alias, so the second identical call resolves EXACTLY and lands here as
   * "exists". A double-tapped button, or a retry after a timeout that actually
   * succeeded, still returns the one row the first call wrote.
   */
  if (outcome.kind === "match" && outcome.exercise.confidence === "exact") {
    return { created: false, reason: "exists", exercise: await dto(outcome.exercise) };
  }

  if (body.force !== true && (outcome.kind === "match" || outcome.kind === "near_miss")) {
    const candidate = outcome.kind === "match" ? outcome.exercise : outcome.candidate;
    return {
      created: false,
      reason: "near_miss",
      suggestion: await dto(candidate),
      // Rounded for the sake of anything that logs it; the client shows the
      // name, never the number. A score is not a thing to put in front of
      // somebody mid-workout. Null for a fuzzy match, whose score is above the
      // band and would only mislead if it were read as one.
      score: outcome.kind === "near_miss" ? Math.round(outcome.score * 100) / 100 : null,
    };
  }

  // `blank` cannot reach here — the letter check above rejects it first.
  const created = await createUserExercise(typed, userId);

  return {
    created: true,
    exercise: {
      id: created.id,
      name: created.name,
      slug: created.slug,
      incrementLb: displayLb(created.incrementKg),
      equipment: created.equipment,
      muscles: created.muscles,
    },
    /*
     * False when the name said nothing certain about which muscles it works.
     *
     * The client has to be able to say so, because the consequence is real and
     * invisible: `getMuscleVolume` INNER JOINs `exercise_muscles`, so sets on
     * an unmapped exercise count in history, in every trend and in every e1RM,
     * and count zero toward weekly volume and the muscle-debt ranking. Guessing
     * instead would be worse — a mis-mapped lift tells the owner for weeks that
     * the wrong muscle is behind.
     */
    musclesInferred: created.musclesInferred,
  };
});

export const OPTIONS = preflight;

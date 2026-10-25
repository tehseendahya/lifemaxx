import { route, HttpError } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { db } from "@/db";
import { exercises } from "@/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { learnAlias } from "@/lib/exercises";
import { requireUuid } from "../../shared";

/** Longest alias worth keeping. Past this it is a sentence, not a name. */
const MAX_ALIAS = 80;

interface Body {
  exerciseId?: string;
  alias?: string;
}

/**
 * Teach the resolver a wording it got wrong.
 *
 * This is what closes the loop on voice logging. The transcript says "weighted
 * pull ups", `resolveExercise` misses or fuzzy-matches something else, the user
 * corrects it in the confirm sheet — and this call means the same phrase lands
 * on the right row for free next time, with no model call and no network.
 *
 * The exercise id is checked against what the user can actually see before it
 * is written. `learnAlias` takes the id on trust, and the aliases table's
 * unique index is on (alias, user_id) rather than on the exercise, so an
 * unvalidated id here would let a guessed uuid attach a personal alias to a row
 * the user has no business naming.
 */
export const POST = route<Body>(async ({ userId, body }) => {
  const exerciseId = requireUuid(body.exerciseId ?? null, "exerciseId");

  const alias = body.alias?.trim() ?? "";
  if (!alias) throw new HttpError("alias is required.");
  if (alias.length > MAX_ALIAS) throw new HttpError(`alias must be under ${MAX_ALIAS} characters.`);

  const [visible] = await db.select({ id: exercises.id })
    .from(exercises)
    .where(and(
      eq(exercises.id, exerciseId),
      or(isNull(exercises.userId), eq(exercises.userId, userId)),
    ))
    .limit(1);

  if (!visible) throw new HttpError("Unknown exercise.", 404);

  // Normalises and de-duplicates on its own — a second correction with the
  // same wording is a no-op, not a conflict.
  await learnAlias(exerciseId, alias, userId);
  return { ok: true };
});

export const OPTIONS = preflight;

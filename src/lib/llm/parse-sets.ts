import { withUser } from "@/db";
import { getLlm, JSON_SCHEMAS, parsedSetsSchema } from "@/lib/llm";
import { MODELS } from "@/lib/models";
import { SETS_SYSTEM } from "@/lib/llm/prompts";
import { parseShorthand } from "@/lib/llm/shorthand";
import { resolveExercise, type ResolvedExercise } from "@/lib/exercises";
import type { ParsedSet } from "@/lib/llm/shorthand";

/**
 * Text to resolved sets. One implementation, two callers.
 *
 * This was the body of `/api/sets/parse`. It moved here unchanged when the
 * native client gained a second door onto the same work — free-text entry from
 * the phone, and a spoken sentence through `/api/voice/transcribe`. Three
 * copies of "shorthand first, model second, then resolve the name" would be
 * three places for the exercise-matching rules to drift, and a set filed
 * against the wrong exercise corrupts trend history silently.
 *
 * The order is the point and is unchanged:
 *
 *  1. `parseShorthand` — deterministic, tested, free, works offline. Most
 *     entries stop here and never reach the network.
 *  2. The model with `SETS_SYSTEM` — only when step 1 returns nothing, which is
 *     what prose does ("did 3 sets weighted pull ups 45lbs for 6 reps" has
 *     "did" where the exercise name should be, so the shorthand parser
 *     correctly declines it).
 *  3. `resolveExercise` per entry, inside `withUser` so RLS decides what is
 *     visible.
 *
 * Nothing here writes. Resolution is a read; the caller confirms and the sets
 * are written by `POST /api/sets`.
 */

export interface ParsedEntryResolved {
  /** The exercise name exactly as the user wrote or said it, before resolution. */
  query: string;
  exercise: ResolvedExercise | null;
  sets: ParsedSet[];
}

export interface ParseSetsResult {
  /** False when the deterministic parser handled it and no model was called. */
  usedModel: boolean;
  entries: ParsedEntryResolved[];
  /** The queries that resolved to nothing. Never guess one on the caller's behalf. */
  unresolved: string[];
}

/**
 * Callers must be scoped `manual`.
 *
 * The model call in step 2 sits between the parse and the database lookup on
 * purpose: `withUser()` holds a Postgres transaction and Supabase's pooler runs
 * in transaction mode, so a multi-second round trip inside one pins a server
 * connection for its duration. Only step 3 is wrapped.
 */
export async function parseSetsText(text: string, userId: string): Promise<ParseSetsResult> {
  let entries = parseShorthand(text);
  let usedModel = false;

  if (entries.length === 0) {
    usedModel = true;
    const result = await getLlm().structured({
      model: MODELS.setsParse,
      messages: [
        { role: "system", content: SETS_SYSTEM },
        { role: "user", content: text },
      ],
      schemaName: "parsed_sets",
      jsonSchema: JSON_SCHEMAS.parsed_sets,
      validator: parsedSetsSchema,
    });
    entries = result.entries;
  }

  const resolved = await withUser(userId, () => Promise.all(
    entries.map(async (entry) => ({
      query: entry.exercise_query,
      exercise: await resolveExercise(entry.exercise_query, userId),
      sets: entry.sets,
    })),
  ));

  return {
    usedModel,
    entries: resolved,
    unresolved: resolved.filter((r) => !r.exercise).map((r) => r.query),
  };
}

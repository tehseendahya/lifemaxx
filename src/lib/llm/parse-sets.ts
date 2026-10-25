import { withUser } from "@/db";
import { getLlm, JSON_SCHEMAS, parsedSetsSchema } from "@/lib/llm";
import { MODELS } from "@/lib/models";
import { SETS_SYSTEM } from "@/lib/llm/prompts";
import { parseLines, roundSetsToDisplayLb } from "@/lib/llm/shorthand";
import { resolveExercise, type ResolvedExercise } from "@/lib/exercises";
import type { ParsedEntry, ParsedSet } from "@/lib/llm/shorthand";

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
 *  1. `parseLines` — deterministic, tested, free, works offline. Most entries
 *     stop here and never reach the network.
 *  2. The model with `SETS_SYSTEM` — only for the lines step 1 could not read,
 *     which is what prose does ("did 3 sets weighted pull ups 45lbs for 6 reps"
 *     has a bare count where the exercise name should be, so the shorthand
 *     parser correctly declines it).
 *  3. `resolveExercise` per entry, inside `withUser` so RLS decides what is
 *     visible.
 *
 * Step 1 is now PER LINE rather than all-or-nothing, and that is the headline
 * fix of this round. The owner pasted five lines; one unsupported form on line
 * 2 meant `parseShorthand` returned `[]` and the whole paste — four lines of
 * good shorthand included — went to the model, which is where the wrong
 * numbers came from. Lines that parse now stay deterministic and only the
 * leftovers cost a round trip. Nothing is dropped: every line either becomes an
 * entry here or is forwarded to the model verbatim.
 *
 * Nothing here writes. Resolution is a read; the caller confirms and the sets
 * are written by `POST /api/sets`.
 */

export interface ParsedEntryResolved {
  /** The exercise name exactly as the user wrote or said it, before resolution. */
  query: string;
  exercise: ResolvedExercise | null;
  /** Weights are whole pounds here — see `roundSetsToDisplayLb`. */
  sets: ParsedSet[];
  /**
   * Chunks that looked like sets but held numbers the parser refused to
   * believe ("165" out of "165,5"). Present only on the deterministic path.
   * Optional and additive: the confirmation sheet can surface these so a
   * dropped chunk is visible rather than silent.
   */
  dropped?: string[];
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
  const lines = parseLines(text);
  const deterministic = lines.flatMap((l) => (l.kind === "entry" ? [l.entry] : []));
  const leftover = lines.flatMap((l) => (l.kind === "unparsed" ? [l.line] : []));

  let entries: ParsedEntry[] = deterministic;
  let usedModel = false;

  if (leftover.length > 0 || deterministic.length === 0) {
    usedModel = true;
    // When nothing parsed, the model gets the original text byte for byte —
    // re-joining would change the prompt for no reason, and the prompt prefix
    // is cached. When only some lines are left over, it gets just those.
    const prompt = deterministic.length === 0 ? text : leftover.join("\n");
    const result = await getLlm().structured({
      model: MODELS.setsParse,
      messages: [
        { role: "system", content: SETS_SYSTEM },
        { role: "user", content: prompt },
      ],
      schemaName: "parsed_sets",
      jsonSchema: JSON_SCHEMAS.parsed_sets,
      validator: parsedSetsSchema,
    });
    // Splice the model's entries in at the first line it was asked about, so a
    // mixed paste comes back in the order the owner typed it.
    const firstLeftover = lines.findIndex((l) => l.kind === "unparsed");
    const before = firstLeftover < 0
      ? deterministic.length
      : lines.slice(0, firstLeftover).filter((l) => l.kind === "entry").length;
    entries = [
      ...deterministic.slice(0, before),
      ...result.entries,
      ...deterministic.slice(before),
    ];
  }

  const resolved = await withUser(userId, () => Promise.all(
    entries.map(async (entry) => ({
      query: entry.exercise_query,
      exercise: await resolveExercise(entry.exercise_query, userId),
      // The display edge. The owner's "20kg" must read "44 lb", not "44.1 lb",
      // and this is also the number the sheet writes back — so it rounds here
      // rather than in the parser, which keeps full precision for the kg
      // round-trip tests.
      sets: roundSetsToDisplayLb(entry.sets),
      ...(entry.dropped ? { dropped: entry.dropped } : {}),
    })),
  ));

  return {
    usedModel,
    entries: resolved,
    unresolved: resolved.filter((r) => !r.exercise).map((r) => r.query),
  };
}

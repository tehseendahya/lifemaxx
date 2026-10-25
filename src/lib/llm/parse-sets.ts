import { withUser } from "@/db";
import { getLlm, JSON_SCHEMAS, parsedSetsSchema } from "@/lib/llm";
import { MODELS } from "@/lib/models";
import { SETS_SYSTEM } from "@/lib/llm/prompts";
import { parseLines, roundSetsToDisplayLb } from "@/lib/llm/shorthand";
import {
  createUserExercise,
  hasNameBeyondSetNotation,
  resolveExerciseOutcome,
  type ResolvedExercise,
} from "@/lib/exercises";
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
 *  3. `resolveExerciseOutcome` per entry, inside `withUser` so RLS decides
 *     what is visible — and, when nothing matches, CREATING the exercise.
 *
 * Step 1 is now PER LINE rather than all-or-nothing, and that is the headline
 * fix of this round. The owner pasted five lines; one unsupported form on line
 * 2 meant `parseShorthand` returned `[]` and the whole paste — four lines of
 * good shorthand included — went to the model, which is where the wrong
 * numbers came from. Lines that parse now stay deterministic and only the
 * leftovers cost a round trip. Nothing is dropped: every line either becomes an
 * entry here or is forwarded to the model verbatim.
 *
 * ── STEP 3 NOW WRITES, AND THAT IS THE SECOND FIX OF THIS ROUND ────────────
 *
 * It used to be true that nothing here wrote: resolution answered yes/no, and
 * "no" put the query into `unresolved` for the phone to draw as a chip. The
 * owner pasted "preacher curls", got that chip, opened the picker, searched,
 * found nothing, and the flow dead-ended — there was no way to create an
 * exercise anywhere in the app.
 *
 * The decision was: unknown exercise -> create it automatically, with a prompt
 * only when it looks like a typo. So an entry whose name resolves to nothing
 * now gets a row written for it here, marked `confidence: "new"`, and the sets
 * are immediately loggable against it. Zero taps for a genuinely new lift.
 *
 * This is still not a write the user has to live with. The exercise is created
 * before they confirm, because the confirmation sheet needs an id to show a
 * name and to log a set against, and `DELETE /api/mobile/exercise` takes it
 * back the moment nothing points at it — which the sheet calls when a group is
 * deleted, when a near miss is answered with "yes, I meant that one", and when
 * the whole sheet is discarded. The sets themselves are still written only by
 * `POST /api/sets`, after the user confirms.
 */

export interface ParsedEntryResolved {
  /** The exercise name exactly as the user wrote or said it, before resolution. */
  query: string;
  /**
   * `confidence: "new"` means this row was created by this request. The phone
   * draws it as `+ Name` with a NEW chip; it does not block confirmation.
   */
  exercise: ResolvedExercise | null;
  /**
   * Something that already existed and resembles `query` closely enough that
   * this might be a typo for it. Set alongside a `"new"` exercise, and on a
   * `"fuzzy"` match where the matcher's own answer is the likelier mistake.
   *
   * It is a QUESTION, never an answer: the sets are filed against `exercise`
   * and log fine if the user ignores it. Answering it re-files them and hands
   * the created row back. This is what stops "bnch pres" silently minting a
   * second bench press and splitting a year of history in half.
   */
  nearMiss?: { id: string; name: string } | null;
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

  const resolved = await withUser(userId, async () => {
    const out: ParsedEntryResolved[] = [];
    /*
     * SEQUENTIAL, not `Promise.all`, and the reason is correctness rather than
     * load.
     *
     * Step 3 can now create a row. Two lines of one paste naming the same
     * unknown lift ("preacher curls" on line 4, "preacher curl" on line 5)
     * would, run concurrently, both resolve to nothing and both create one —
     * two rows for one movement, from a single paste, with the history split
     * between them from the first day. Run in order, the first creates it and
     * learns the wording as an alias, so the second resolves EXACTLY at tier 1
     * and the two lines share the row. The cost is a handful of extra round
     * trips on an already-open connection, over the five-ish entries a paste
     * holds.
     */
    for (const entry of entries) {
      const query = entry.exercise_query;
      const { exercise, nearMiss } = await resolveOrCreate(query, userId);
      out.push({
        query,
        exercise,
        ...(nearMiss ? { nearMiss } : {}),
        // The display edge. The owner's "20kg" must read "44 lb", not
        // "44.1 lb", and this is also the number the sheet writes back — so it
        // rounds here rather than in the parser, which keeps full precision for
        // the kg round-trip tests.
        sets: roundSetsToDisplayLb(entry.sets),
        ...(entry.dropped ? { dropped: entry.dropped } : {}),
      });
    }
    return out;
  });

  return {
    usedModel,
    entries: resolved,
    unresolved: resolved.filter((r) => !r.exercise).map((r) => r.query),
  };
}

/**
 * One entry's exercise: matched, or created on the spot.
 *
 * The three outcomes of `resolveExerciseOutcome` become two fields, because
 * the phone's confirmation sheet has exactly two things to draw — which
 * exercise the sets are filed against, and whether there is a question to ask
 * about it.
 *
 *   match      -> the row, `exact` or `fuzzy`. A fuzzy match carries the same
 *                 candidate as a question, since the matcher choosing a
 *                 *different* lift that shares a head noun ("JM press" ->
 *                 Overhead Press) is the likelier error and the one the owner
 *                 hit with "incline smith press".
 *   near_miss  -> create it AND ask. Both, not either: creating means the sets
 *                 log with zero taps if the name was genuinely new, and asking
 *                 means a typo gets caught before it becomes a duplicate.
 *   new        -> create it, no question.
 *   blank      -> nothing. Never create from a query with no letters.
 *
 * A creation that fails is not allowed to fail the parse. The entry comes back
 * unresolved, which the phone already draws as a chip with a working picker
 * behind it — losing one exercise name to a fallible write is recoverable in
 * two taps, whereas throwing would lose the user's whole paste.
 */
async function resolveOrCreate(
  query: string,
  userId: string,
): Promise<{ exercise: ResolvedExercise | null; nearMiss: { id: string; name: string } | null }> {
  const outcome = await resolveExerciseOutcome(query, userId);

  if (outcome.kind === "match") {
    const { exercise } = outcome;
    return {
      exercise,
      nearMiss: exercise.confidence === "fuzzy" ? { id: exercise.id, name: exercise.name } : null,
    };
  }

  if (outcome.kind === "blank") return { exercise: null, nearMiss: null };

  /*
   * The guard that keeps the automatic path from writing junk.
   *
   * The shorthand parser needs a name before the first number, so text it
   * cannot read reaches the model and comes back with whatever it made of it —
   * and `225x5` is the documented shape of that failure. Creating from it would
   * leave a row called "225x5" in the owner's picker forever. Shared with
   * `POST /api/mobile/exercise/create` rather than copied, because this path
   * needs it more: there, the user typed the name and is looking at it; here,
   * nobody sees it before the row is written.
   */
  if (!hasNameBeyondSetNotation(query)) return { exercise: null, nearMiss: null };

  const nearMiss = outcome.kind === "near_miss"
    ? { id: outcome.candidate.id, name: outcome.candidate.name }
    : null;

  try {
    const created = await createUserExercise(query, userId);
    return { exercise: { ...created, confidence: "new" }, nearMiss };
  } catch {
    return { exercise: null, nearMiss: null };
  }
}

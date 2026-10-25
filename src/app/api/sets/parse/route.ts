import { route } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { parseSetsText } from "@/lib/llm/parse-sets";

/**
 * Shorthand parser first, model second.
 *
 * The three steps that used to live here — `parseShorthand`, then the model
 * with `SETS_SYSTEM`, then resolution per entry inside `withUser` — now live in
 * `src/lib/llm/parse-sets.ts`, because the native client's free-text and spoken
 * entry paths need exactly the same work and exercise matching must not have
 * two implementations.
 *
 * The response shape is still what `src/components/SetLogger.tsx` in the web
 * app reads — `entries[].exercise.id`, `entries[].exercise.name` and
 * `unresolved` — and it gained three optional fields this round (`nearMiss`,
 * `dropped`, and `"new"` as a `confidence`). Resolution now CREATES an
 * exercise it cannot find, so the "Couldn't match: ..." alert fires for a
 * great deal less.
 *
 * SetLogger reads `nearMiss`. It used to ignore it, and that was not the
 * harmless simplification an earlier version of this comment claimed: the
 * owner's decision was "create automatically BUT FLAG NEAR-MISSES", and
 * ignoring the flag is how "bnch pres" silently mints a second bench press
 * and splits a year of history. The web asks before it enqueues — see
 * `src/components/near-miss.ts`.
 *
 * Scoping is manual because the fallback is a model call: it happens between
 * the parse and the database lookup, never inside a transaction.
 */
export const POST = route<{ text: string }>(async ({ userId, body }) => {
  const text = body.text?.trim();
  if (!text) throw new Error("Nothing to parse.");

  return parseSetsText(text, userId);
}, { scope: "manual" });

// The phone posts here too — free-text set entry, and re-parsing a corrected
// transcript. Native fetch ignores CORS, but Expo's web target does not.
export const OPTIONS = preflight;

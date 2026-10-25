import { route } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { parseSetsText } from "@/lib/llm/parse-sets";

/**
 * Shorthand parser first, model second.
 *
 * The three steps that used to live here — `parseShorthand`, then the model
 * with `SETS_SYSTEM`, then `resolveExercise` per entry inside `withUser` — now
 * live in `src/lib/llm/parse-sets.ts`, because the native client's free-text
 * and spoken entry paths need exactly the same work and exercise matching must
 * not have two implementations. The response shape is unchanged:
 * `src/components/SetLogger.tsx` in the web app reads `entries[].exercise.id`,
 * `entries[].exercise.name` and `unresolved` from it.
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

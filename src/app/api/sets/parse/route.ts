import { route } from "@/lib/api";
import { getLlm, JSON_SCHEMAS, parsedSetsSchema } from "@/lib/llm";
import { MODELS } from "@/lib/models";
import { SETS_SYSTEM } from "@/lib/llm/prompts";
import { parseShorthand } from "@/lib/llm/shorthand";
import { resolveExercise } from "@/lib/exercises";

/**
 * Shorthand parser first, model second.
 *
 * The deterministic parser handles the notation people actually type, costs
 * nothing and works offline — so most gym entries never reach the network. The
 * model is the fallback for prose and unusual phrasing, not the default path.
 */
export const POST = route<{ text: string }>(async ({ userId, body }) => {
  const text = body.text?.trim();
  if (!text) throw new Error("Nothing to parse.");

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

  const resolved = await Promise.all(
    entries.map(async (entry) => ({
      query: entry.exercise_query,
      exercise: await resolveExercise(entry.exercise_query, userId),
      sets: entry.sets,
    })),
  );

  return {
    usedModel,
    entries: resolved,
    unresolved: resolved.filter((r) => !r.exercise).map((r) => r.query),
  };
});

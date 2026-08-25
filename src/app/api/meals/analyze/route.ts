import { route } from "@/lib/api";
import { withUser } from "@/db";
import { getLlm, JSON_SCHEMAS, mealAnalysisSchema, type Message, type ContentPart } from "@/lib/llm";
import { MODELS } from "@/lib/models";
import { MEAL_SYSTEM, goalsBlock } from "@/lib/llm/prompts";
import { getProfile } from "@/lib/queries";

interface Body {
  /** data: URI. Never written to disk — held in memory for this call only. */
  imageDataUrl?: string;
  note?: string;
}

export const POST = route<Body>(async ({ userId, body }) => {
  if (!body.imageDataUrl && !body.note?.trim()) {
    throw new Error("Send a photo, a note, or both.");
  }

  // Scoped read first, then the model call outside the transaction — see
  // RouteOptions.scope in lib/api.ts for why the two must not overlap.
  const profile = await withUser(userId, () => getProfile(userId));

  // Prefix order is load-bearing: goals and system prompt are stable across
  // every call, so they sit in front and stay in the cache.
  const messages: Message[] = [
    { role: "system", content: `${goalsBlock(profile?.goalsText ?? "")}\n\n${MEAL_SYSTEM}` },
  ];

  const parts: ContentPart[] = [];
  if (body.imageDataUrl) {
    parts.push({ type: "image_url", image_url: { url: body.imageDataUrl, detail: "low" } });
  }
  parts.push({
    type: "text",
    text: body.note?.trim()
      ? `The person's note about this meal: "${body.note.trim()}"\n\nTrust the note over the image where they disagree.`
      : "No note provided. Estimate from the image alone and set confidence accordingly.",
  });
  messages.push({ role: "user", content: parts });

  const analysis = await getLlm().structured({
    model: MODELS.mealAnalyze,
    messages,
    schemaName: "meal_analysis",
    jsonSchema: JSON_SCHEMAS.meal_analysis,
    validator: mealAnalysisSchema,
  });

  const totals = analysis.items.reduce(
    (a, i) => ({
      kcal: a.kcal + i.kcal,
      proteinG: a.proteinG + i.protein_g,
      carbsG: a.carbsG + i.carbs_g,
      fatG: a.fatG + i.fat_g,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );

  // The image is not persisted anywhere. It dies with this request.
  return { ...analysis, totals };
}, { scope: "manual" });

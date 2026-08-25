import { z } from "zod";

/**
 * Response schemas. These are the contract with the model — every structured
 * route sends the JSON Schema form and validates the reply with the Zod form,
 * so a malformed response is a caught error rather than a runtime surprise
 * three layers down.
 */

export const mealAnalysisSchema = z.object({
  items: z.array(z.object({
    name: z.string(),
    qty: z.number().nullable(),
    unit: z.string().nullable(),
    kcal: z.number(),
    protein_g: z.number(),
    carbs_g: z.number(),
    fat_g: z.number(),
  })),
  confidence: z.number().min(0).max(1),
  note: z.string(),
});
export type MealAnalysis = z.infer<typeof mealAnalysisSchema>;

export const parsedSetsSchema = z.object({
  entries: z.array(z.object({
    exercise_query: z.string(),
    sets: z.array(z.object({
      reps: z.number().int().positive(),
      weight_lb: z.number().nonnegative(),
      rpe: z.number().min(1).max(10).nullable(),
      to_failure: z.boolean(),
      is_warmup: z.boolean(),
    })),
  })),
});
export type ParsedSets = z.infer<typeof parsedSetsSchema>;

export const suggestionSchema = z.object({
  weight_lb: z.number().nonnegative(),
  sets: z.number().int().positive(),
  reps: z.number().int().positive(),
  reason: z.string(),
});
export type Suggestion = z.infer<typeof suggestionSchema>;

export const exerciseMatchSchema = z.object({
  matched_slug: z.string().nullable(),
  is_new: z.boolean(),
  canonical_name: z.string(),
  equipment: z.string(),
  muscles: z.array(z.object({
    muscle: z.string(),
    contribution: z.number().min(0).max(1),
  })),
});
export type ExerciseMatch = z.infer<typeof exerciseMatchSchema>;

/**
 * OpenAI structured outputs require every property to be listed in `required`
 * and `additionalProperties: false` throughout. Hand-writing both the Zod and
 * JSON Schema forms is repetitive but keeps the wire format explicit — and this
 * is the layer where a silent mismatch costs the most.
 */
const obj = (properties: Record<string, unknown>) => ({
  type: "object" as const,
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const num = { type: "number" as const };
const str = { type: "string" as const };
const bool = { type: "boolean" as const };
const nullable = (t: object) => ({ ...t, type: [(t as any).type, "null"] });

export const JSON_SCHEMAS = {
  meal_analysis: obj({
    items: {
      type: "array",
      items: obj({
        name: str, qty: nullable(num), unit: nullable(str),
        kcal: num, protein_g: num, carbs_g: num, fat_g: num,
      }),
    },
    confidence: num,
    note: str,
  }),
  parsed_sets: obj({
    entries: {
      type: "array",
      items: obj({
        exercise_query: str,
        sets: {
          type: "array",
          items: obj({
            reps: num, weight_lb: num, rpe: nullable(num),
            to_failure: bool, is_warmup: bool,
          }),
        },
      }),
    },
  }),
  suggestion: obj({ weight_lb: num, sets: num, reps: num, reason: str }),
  exercise_match: obj({
    matched_slug: nullable(str),
    is_new: bool,
    canonical_name: str,
    equipment: str,
    muscles: { type: "array", items: obj({ muscle: str, contribution: num }) },
  }),
} as const;

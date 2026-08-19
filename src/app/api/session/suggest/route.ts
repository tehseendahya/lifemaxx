import { route } from "@/lib/api";
import { getLlm, JSON_SCHEMAS, suggestionSchema } from "@/lib/llm";
import { MODELS } from "@/lib/models";
import { SUGGEST_SYSTEM, goalsBlock, stableJson } from "@/lib/llm/prompts";
import { computeBaseline, clampSuggestion, type PreviousSession } from "@/lib/domain/progression";
import { kgToLb, lbToKg, displayLb } from "@/lib/domain/units";
import { db } from "@/db";
import { exercises } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getExerciseHistory, getProfile, getActiveWorkout, getWorkoutSets } from "@/lib/queries";

/**
 * The model proposes; the baseline constrains.
 *
 * Both numbers come back and both are shown. When the AI deviates you can see
 * it deviating and why, which is what keeps it trustworthy in month six rather
 * than just week one.
 */
export const POST = route<{ exerciseId: string }>(async ({ userId, body }) => {
  const [exercise] = await db.select().from(exercises)
    .where(eq(exercises.id, body.exerciseId)).limit(1);
  if (!exercise) throw new Error("Unknown exercise.");

  const history = await getExerciseHistory(userId, exercise.id, 5);
  const asSessions: PreviousSession[] = history.map((h) => ({
    date: h.date,
    sets: h.sets.map((s) => ({
      reps: s.reps, weightKg: s.weightKg, rpe: s.rpe,
      toFailure: s.toFailure, isWarmup: s.isWarmup,
    })),
  }));

  const baseline = computeBaseline(asSessions, exercise.incrementKg);

  // No history means nothing to reason about — don't spend a call on it.
  if (baseline.action === "start") {
    return { baseline: toLbView(baseline), suggestion: null, clamped: false };
  }

  const profile = await getProfile(userId);
  const active = await getActiveWorkout(userId);
  const todaySets = active ? await getWorkoutSets(active.id) : [];

  const context = stableJson({
    exercise: exercise.name,
    baseline_lb: displayLb(baseline.weightKg),
    baseline_sets: baseline.sets,
    baseline_reps: baseline.reps,
    baseline_reason: baseline.reason,
    history: history.map((h) => ({
      date: h.date,
      sets: h.sets.filter((s) => !s.isWarmup).map((s) => ({
        reps: s.reps, lb: displayLb(s.weightKg), rpe: s.rpe,
        to_failure: s.toFailure, felt: s.felt, note: s.note,
      })),
    })),
    today_so_far: todaySets.filter((s) => !s.isWarmup).map((s) => ({
      exercise: s.exerciseName, reps: s.reps, lb: displayLb(s.weightKg),
      rpe: s.rpe, to_failure: s.toFailure, felt: s.felt,
    })),
  });

  let suggestion = null;
  let clamped = false;
  try {
    const raw = await getLlm().structured({
      model: MODELS.sessionSuggest,
      messages: [
        { role: "system", content: `${goalsBlock(profile?.goalsText ?? "")}\n\n${SUGGEST_SYSTEM}` },
        { role: "user", content: `The baseline is ${displayLb(baseline.weightKg)} lb for ${baseline.sets} sets of ${baseline.reps}.\n\n${context}` },
      ],
      schemaName: "suggestion",
      jsonSchema: JSON_SCHEMAS.suggestion,
      validator: suggestionSchema,
      maxTokens: 300,
    });

    const clampResult = clampSuggestion(lbToKg(raw.weight_lb), baseline.weightKg, exercise.incrementKg);
    clamped = clampResult.clamped;
    suggestion = {
      weightLb: displayLb(clampResult.weightKg),
      sets: raw.sets,
      reps: raw.reps,
      reason: raw.reason,
    };
  } catch (err) {
    // A failed suggestion must never block logging. The baseline stands alone.
    console.warn("[suggest] falling back to baseline:", err);
  }

  return { baseline: toLbView(baseline), suggestion, clamped };
});

function toLbView(b: ReturnType<typeof computeBaseline>) {
  return { action: b.action, weightLb: displayLb(b.weightKg), sets: b.sets, reps: b.reps, reason: b.reason };
}

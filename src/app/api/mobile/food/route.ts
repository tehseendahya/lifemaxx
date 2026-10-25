import { route } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import {
  getDayMeals, sumMacros, getActiveTarget, defaultProteinTarget,
} from "@/lib/queries";
import { requireLocalDate } from "../shared";

/**
 * One day's food. `?date=` defaults to today.
 *
 * The target comes back alongside the meals rather than being read from the
 * bootstrap payload, because the date is arbitrary: targets are versioned by
 * `effective_from`, so scrolling back a fortnight has to show what the target
 * was then, not what it is now.
 */
export const GET = route(async ({ userId, today, searchParams }) => {
  const date = requireLocalDate(searchParams.get("date"), today);

  const [meals, target, proteinFloor] = await Promise.all([
    getDayMeals(userId, date),
    getActiveTarget(userId, date),
    defaultProteinTarget(userId),
  ]);

  return {
    date,
    meals: meals.map((m) => ({
      id: m.id,
      slot: m.slot,
      note: m.note,
      source: m.source,
      confidence: m.confidence,
      kcal: m.kcal,
      proteinG: m.proteinG,
      carbsG: m.carbsG,
      fatG: m.fatG,
      items: m.items.map((i) => ({
        name: i.name,
        qty: i.qty,
        unit: i.unit,
        kcal: i.kcal,
        proteinG: i.proteinG,
        carbsG: i.carbsG,
        fatG: i.fatG,
      })),
    })),
    totals: sumMacros(meals),
    target: {
      kcal: target?.kcal ?? null,
      proteinG: target?.proteinG ?? proteinFloor,
      carbsG: target?.carbsG ?? null,
      fatG: target?.fatG ?? null,
      mode: target?.mode ?? "calibrating",
    },
  };
});

export const OPTIONS = preflight;

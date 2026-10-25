import type { WeighIn } from "./domain/tdee";
import { displayLb } from "./domain/units";

/**
 * The `history` block of `GET /api/mobile/bootstrap`, assembled.
 *
 * Split out of `queries.ts` for one reason: `queries.ts` imports `@/db`, which
 * opens a Postgres connection at module load, so nothing that imports it can be
 * unit-tested without a live database. The merge below is the only part of the
 * history payload that is a decision rather than a query, so it lives where a
 * test can reach it.
 */

export interface HistoryDay {
  date: string;
  weightLb: number | null;
  kcal: number | null;
  hardSets: number;
}

/**
 * Three per-day series → one ascending array, one row per day that has
 * something in it.
 *
 * Days with nothing logged are ABSENT rather than present-and-zero, and that is
 * the whole contract: the phone draws a weigh-in as a mark and never joins two
 * marks with a line, so a missing day has to be distinguishable from a logged
 * one. Zero-filling here would turn "I did not weigh in on Tuesday" into "I
 * weighed nothing on Tuesday", and the client could no longer tell the
 * difference.
 *
 * `hardSets` is the one field that is a number rather than a nullable one: a day
 * present because of a weigh-in, with no sets, genuinely did have zero working
 * sets. A null there would mean "unknown", which it is not.
 *
 * `weightLb` is rounded to a whole pound on purpose. The owner asked for
 * rounded pounds everywhere, and a chart's direct end label has room for three
 * digits, not "182.3".
 */
export function mergeHistoryDays(
  weighIns: WeighIn[],
  intake: { localDate: string; kcal: number }[],
  hardSets: { localDate: string; hardSets: number }[],
): HistoryDay[] {
  const byDate = new Map<string, HistoryDay>();
  const at = (date: string): HistoryDay => {
    const existing = byDate.get(date);
    if (existing) return existing;
    const fresh: HistoryDay = { date, weightLb: null, kcal: null, hardSets: 0 };
    byDate.set(date, fresh);
    return fresh;
  };

  for (const w of weighIns) at(w.localDate).weightLb = Math.round(displayLb(w.weightKg));
  // A day whose meals sum to 0 kcal is not a day with intake data — `sum()`
  // over no rows cannot happen here (the group only exists if a meal does), but
  // a deleted-down-to-nothing day can, and a 0 would drag the rolling mean.
  for (const i of intake) if (i.kcal > 0) at(i.localDate).kcal = i.kcal;
  for (const h of hardSets) at(h.localDate).hardSets = h.hardSets;

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

import type { Muscle } from "@/db/schema";

/**
 * Hard-set accounting.
 *
 * A working set contributes fractionally to several muscles — bench is 1.0 chest
 * but also 0.5 front delt and 0.5 tricep. Summing those fractions over a week is
 * the number that actually drives hypertrophy decisions, and it's the single
 * input behind session auto-naming, the weekly balance view and the homepage
 * ranking. One table, three features.
 */

export interface MuscleContribution {
  muscle: Muscle;
  contribution: number;
}

export interface CountedSet {
  isWarmup?: boolean;
  muscles: MuscleContribution[];
}

/** Roughly the consensus productive range for a trained lifter. */
export const WEEKLY_SET_TARGET = { min: 10, max: 20 } as const;

/** Warmups don't count. They're not stimulus. */
export function hardSetsByMuscle(sets: CountedSet[]): Map<Muscle, number> {
  const totals = new Map<Muscle, number>();
  for (const set of sets) {
    if (set.isWarmup) continue;
    for (const { muscle, contribution } of set.muscles) {
      totals.set(muscle, (totals.get(muscle) ?? 0) + contribution);
    }
  }
  return totals;
}

const PUSH: Muscle[] = ["chest", "front_delt", "tricep", "side_delt"];
const PULL: Muscle[] = ["lat", "upper_back", "bicep", "rear_delt", "trap"];
const LEGS: Muscle[] = ["quad", "hamstring", "glute", "calf", "adductor", "abductor"];

const LABELS: Record<Muscle, string> = {
  chest: "Chest", front_delt: "Front Delts", side_delt: "Side Delts",
  rear_delt: "Rear Delts", lat: "Lats", upper_back: "Upper Back",
  trap: "Traps", bicep: "Biceps", tricep: "Triceps", forearm: "Forearms",
  quad: "Quads", hamstring: "Hamstrings", glute: "Glutes", calf: "Calves",
  abs: "Abs", lower_back: "Lower Back", adductor: "Adductors", abductor: "Abductors",
};

export const muscleLabel = (m: Muscle): string => LABELS[m];

/**
 * Name a session from what it actually hit.
 * "Push — Chest & Triceps" reads better than "Workout 47" and costs nothing.
 */
export function deriveWorkoutName(sets: CountedSet[]): string {
  const totals = hardSetsByMuscle(sets);
  if (totals.size === 0) return "Workout";

  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((s, [, v]) => s + v, 0);

  const share = (group: Muscle[]) =>
    ranked.filter(([m]) => group.includes(m)).reduce((s, [, v]) => s + v, 0) / total;

  const push = share(PUSH);
  const pull = share(PULL);
  const legs = share(LEGS);

  const top = ranked.slice(0, 2).map(([m]) => muscleLabel(m));
  const pair = top.length === 2 ? `${top[0]} & ${top[1]}` : top[0];

  if (legs >= 0.6) return `Legs — ${pair}`;
  if (push >= 0.6) return `Push — ${pair}`;
  if (pull >= 0.6) return `Pull — ${pair}`;
  if (push + pull >= 0.8) return `Upper — ${pair}`;
  return `Full Body — ${pair}`;
}

/** Where a muscle sits against the productive range this week. */
export function volumeStatus(sets: number): "under" | "in_range" | "over" {
  if (sets < WEEKLY_SET_TARGET.min) return "under";
  if (sets > WEEKLY_SET_TARGET.max) return "over";
  return "in_range";
}

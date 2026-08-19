import type { Muscle } from "@/db/schema";
import { WEEKLY_SET_TARGET, muscleLabel, volumeStatus } from "./muscles";

/**
 * "What should I train next?"
 *
 * This is the feature that replaces a split. A split is a manual heuristic for
 * balanced weekly volume; this computes the same thing from what you actually
 * did, which means it self-corrects when you improvise. Skip a day on a program
 * and you're behind with nothing to tell you. Skip a day here and tomorrow's
 * homepage says so.
 *
 * No soreness input. Soreness tracks novelty more than fatigue — it's loudest
 * when you do something unfamiliar and goes quiet exactly when you're training
 * hard enough to need the signal. Recovery time and volume debt carry it.
 */

export interface MuscleState {
  muscle: Muscle;
  setsLast7d: number;
  daysSinceTrained: number | null;
  /** Fraction of last session's sets on this muscle marked "weak". */
  weakShare?: number;
}

export interface Recommendation {
  muscle: Muscle;
  label: string;
  score: number;
  setsLast7d: number;
  daysSinceTrained: number | null;
  status: "under" | "in_range" | "over";
  reason: string;
}

/** Typical recovery window before a muscle is ready for real work again. */
const RECOVERY_DAYS = 2;
const NEVER_TRAINED_DAYS = 14;

/**
 * Higher score = train this sooner.
 *
 * Volume debt dominates, because it's the thing with a target. Recovery gates
 * it — a muscle you hammered yesterday scores near zero however far behind it
 * is, since training it again today isn't the answer.
 */
export function scoreMuscle(state: MuscleState): number {
  const debt = Math.max(0, WEEKLY_SET_TARGET.min - state.setsLast7d) / WEEKLY_SET_TARGET.min;

  const days = state.daysSinceTrained ?? NEVER_TRAINED_DAYS;
  const recovery = Math.min(1, days / RECOVERY_DAYS);

  // Performance signal, if it exists. A muscle that felt weak last time gets a
  // small nudge down — not a veto, just a thumb on the scale.
  const weakness = 1 - (state.weakShare ?? 0) * 0.3;

  const overworked = state.setsLast7d > WEEKLY_SET_TARGET.max ? 0.4 : 1;

  return debt * recovery * weakness * overworked;
}

function reasonFor(state: MuscleState, status: ReturnType<typeof volumeStatus>): string {
  const sets = Math.round(state.setsLast7d * 10) / 10;
  const days = state.daysSinceTrained;

  if (days === null) return `Never logged. ${WEEKLY_SET_TARGET.min} sets a week is the target.`;
  if (days < RECOVERY_DAYS) return `Trained ${days === 0 ? "today" : "yesterday"} — still recovering.`;
  if (status === "over") return `${sets} sets this week, already above range.`;
  if (status === "under") return `${sets} of ${WEEKLY_SET_TARGET.min} sets this week, last hit ${days} days ago.`;
  return `${sets} sets this week — in range, last hit ${days} days ago.`;
}

export function rankMuscles(states: MuscleState[]): Recommendation[] {
  return states
    .map((state) => {
      const status = volumeStatus(state.setsLast7d);
      return {
        muscle: state.muscle,
        label: muscleLabel(state.muscle),
        score: scoreMuscle(state),
        setsLast7d: state.setsLast7d,
        daysSinceTrained: state.daysSinceTrained,
        status,
        reason: reasonFor(state, status),
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** One sentence for the top of the homepage. */
export function summarize(ranked: Recommendation[]): string {
  const due = ranked.filter((r) => r.score > 0.2).slice(0, 2);
  if (due.length === 0) return "Everything's in range this week. Train whatever you feel like.";
  if (due.length === 1) return `${due[0].label} is owed sets — ${due[0].reason.toLowerCase()}`;
  return `${due[0].label} and ${due[1].label} are owed sets this week.`;
}

import { epley } from "./e1rm";
import { snapToLoadableKg } from "./units";

/**
 * The mechanical baseline.
 *
 * This is deliberately boring: hit everything you were asked for and the weight
 * goes up one increment; miss and you repeat. The model is allowed to propose
 * something different (see /api/session/suggest) but this number is always
 * computed and always shown next to it, so when the AI deviates you can see it
 * deviating and decide whether you agree.
 *
 * Nothing here calls a model. It must stay pure so it works offline in a gym
 * basement, which is exactly where it gets used.
 */

export interface PreviousSet {
  reps: number;
  weightKg: number;
  rpe?: number | null;
  toFailure?: boolean;
  isWarmup?: boolean;
}

export interface PreviousSession {
  date: string;
  sets: PreviousSet[];
}

export type BaselineAction = "increase" | "repeat" | "deload" | "start";

export interface Baseline {
  action: BaselineAction;
  weightKg: number;
  sets: number;
  reps: number;
  reason: string;
}

/** Three consecutive failed sessions is a stall, not a bad day. */
export const STALL_SESSIONS = 3;
/** Deload to 90% — enough to feel different, not enough to lose the month. */
export const DELOAD_FACTOR = 0.9;

export function computeBaseline(
  history: PreviousSession[],
  incrementKg: number,
  targetReps = 5,
  targetSets = 3,
): Baseline {
  const sessions = history.filter((s) => s.sets.some((x) => !x.isWarmup));

  if (sessions.length === 0) {
    return {
      action: "start",
      weightKg: 0,
      sets: targetSets,
      reps: targetReps,
      reason: "First time logging this. Pick something you could do for 8 and start there.",
    };
  }

  const last = sessions[0];
  const working = last.sets.filter((s) => !s.isWarmup);
  const topWeight = Math.max(...working.map((s) => s.weightKg));
  const atTop = working.filter((s) => s.weightKg >= topWeight - 0.01);
  const hitAll = atTop.length >= targetSets && atTop.every((s) => s.reps >= targetReps);

  if (hitAll) {
    return {
      action: "increase",
      weightKg: snapToLoadableKg(topWeight + incrementKg, incrementKg),
      sets: targetSets,
      reps: targetReps,
      reason: `You completed ${targetSets}×${targetReps} last time. Take the increment.`,
    };
  }

  // Count consecutive sessions that failed at this same weight.
  let consecutiveMisses = 0;
  for (const session of sessions) {
    const w = session.sets.filter((s) => !s.isWarmup);
    if (w.length === 0) break;
    const top = Math.max(...w.map((s) => s.weightKg));
    if (Math.abs(top - topWeight) > 0.01) break;
    const at = w.filter((s) => s.weightKg >= top - 0.01);
    if (at.length >= targetSets && at.every((s) => s.reps >= targetReps)) break;
    consecutiveMisses += 1;
  }

  if (consecutiveMisses >= STALL_SESSIONS) {
    return {
      action: "deload",
      weightKg: snapToLoadableKg(topWeight * DELOAD_FACTOR, incrementKg),
      sets: targetSets,
      reps: targetReps,
      reason: `Third session stuck at this weight. Drop 10% and build back — that's faster than grinding.`,
    };
  }

  const missed = atTop.filter((s) => s.reps < targetReps).length;
  const shortBy = targetSets - atTop.length;
  const detail = shortBy > 0
    ? `you got ${atTop.length} of ${targetSets} sets`
    : `${missed} set${missed === 1 ? "" : "s"} came up short`;

  return {
    action: "repeat",
    weightKg: topWeight,
    sets: targetSets,
    reps: targetReps,
    reason: `Same weight — ${detail} last time. Close it out before adding load.`,
  };
}

/**
 * Guardrail on whatever the model proposes.
 *
 * The model can reason about RPE, sleep and how the last set felt, which the
 * rule can't. What it must not do is get excited: a suggestion may move at most
 * one increment or 10% from the baseline, whichever is smaller.
 */
export function clampSuggestion(
  suggestedKg: number,
  baselineKg: number,
  incrementKg: number,
): { weightKg: number; clamped: boolean } {
  if (baselineKg <= 0) return { weightKg: suggestedKg, clamped: false };
  const maxDelta = Math.min(incrementKg, baselineKg * 0.1);
  const lo = baselineKg - maxDelta;
  const hi = baselineKg + maxDelta;
  if (suggestedKg > hi) return { weightKg: snapToLoadableKg(hi, incrementKg), clamped: true };
  if (suggestedKg < lo) return { weightKg: snapToLoadableKg(lo, incrementKg), clamped: true };
  return { weightKg: suggestedKg, clamped: false };
}

/** Did this session set a PR worth telling you about? */
export function detectPr(
  current: PreviousSet[],
  history: PreviousSession[],
): { kind: "e1rm" | "rep" | null; detail: string } {
  const work = current.filter((s) => !s.isWarmup);
  if (work.length === 0) return { kind: null, detail: "" };

  const prior = history.flatMap((s) => s.sets.filter((x) => !x.isWarmup));
  if (prior.length === 0) return { kind: null, detail: "" };

  const bestNow = Math.max(...work.map((s) => epley(s.weightKg, s.reps)));
  const bestBefore = Math.max(...prior.map((s) => epley(s.weightKg, s.reps)));
  if (bestNow > bestBefore + 0.01) {
    return { kind: "e1rm", detail: `New estimated 1RM — up from your previous best.` };
  }

  const heaviest = Math.max(...work.map((s) => s.weightKg));
  const repsAtHeaviest = Math.max(
    ...work.filter((s) => s.weightKg >= heaviest - 0.01).map((s) => s.reps),
  );
  const priorAt = prior.filter((s) => Math.abs(s.weightKg - heaviest) < 0.01);
  if (priorAt.length > 0 && repsAtHeaviest > Math.max(...priorAt.map((s) => s.reps))) {
    return { kind: "rep", detail: `Most reps you've done at this weight.` };
  }

  return { kind: null, detail: "" };
}

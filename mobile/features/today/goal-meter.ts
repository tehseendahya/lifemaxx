/*
 * Relative imports, same reason as `model.ts`: this module has to run under the
 * node-environment vitest config, so it stays free of `react-native` and of
 * build configuration.
 */
import type { Bootstrap } from "../../lib/types";
import { fmtWeight } from "../voice/model";
import { bestE1rmLbFor, currentWeightLb, dayNumber, formatShortDate, signed } from "./model";
import type { GoalGap, TargetRow } from "./model";

/**
 * One goal as a labelled meter: where it is now, where it is going, how far.
 *
 * The Strava/Ladder goal row, chosen because the old row was a headline and a
 * line of arithmetic ("e1RM 185 → 205 · +20 lb") that had to be read to be
 * understood. A filled bar is read at a glance, and the arithmetic stays
 * underneath it for when the glance is not enough.
 *
 * ── WHEN THERE IS NO METER ─────────────────────────────────────────────────
 *
 *  - No measurement: no meter, never an empty one. A 0% bar under "Bench 205"
 *    reads as "you bench nothing", which is the dead-grey-bar mistake the Food
 *    card already made once. One line says what fills it instead.
 *  - Run and rep goals: text only, as before. A rep target has no measurement
 *    in `bootstrap` (see `gapFor`), and a run target's "progress" would be pace
 *    over distance, two units in one bar.
 *
 * ── DIRECTION ──────────────────────────────────────────────────────────────
 *
 * A lift meter is `now / target`: zero is a real zero for a load. A bodyweight
 * meter is NOT — nobody's bodyweight starts at zero — so it is the distance
 * travelled from where they started over the distance to go, signed so a cut
 * and a bulk both fill as they progress. `start` is the first weigh-in in the
 * 56-day history, which is the oldest honest baseline the phone holds.
 */

export interface GoalMeter {
  /** 0..1, clamped. */
  fraction: number;
  met: boolean;
  /** The figure at the left end of the bar: where it is now. */
  nowLabel: string;
  /** The figure at the right end: the target, with its unit. */
  targetLabel: string;
}

export interface GoalRowView {
  key: string;
  /** "Barbell Bench Press" or "Bodyweight" — the thing, not the arithmetic. */
  title: string;
  /** "9 weeks left", and whether it is tight. */
  deadline: TargetRow["deadline"];
  meter: GoalMeter | null;
  /** The line under the meter, or the whole content when there is none. */
  line: GoalGap;
  /** "since 1 Oct" — bodyweight meters only, so the baseline is visible. */
  since: string | null;
  /** Rate needed against rate achieved, when there is a fortnight of data. */
  pace: TargetRow["pace"];
  /** The owner's sentence, verbatim. You prints it; Today does not. */
  sentence: string;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Weeks to a deadline, or null without one / after it. */
function weeksLeft(byDate: string | null, today: string): number | null {
  if (byDate === null) return null;
  const weeks = (dayNumber(byDate) - dayNumber(today)) / 7;
  return weeks > 0 ? weeks : null;
}

/** The first weigh-in in the 56-day history: the bodyweight meter's start. */
function firstWeighIn(b: Bootstrap): { date: string; lb: number } | null {
  const first = b.history.days.find((d) => d.weightLb !== null);
  return first ? { date: first.date, lb: first.weightLb as number } : null;
}

/**
 * A `TargetRow` from `goalsBlock` → the meter row both screens draw.
 *
 * Takes the row rather than the raw claim so the deadline, the gap tone and the
 * pace line are `model.ts`'s, computed once — this only adds the bar and the
 * shorter line beneath it.
 */
export function goalMeter(row: TargetRow, b: Bootstrap): GoalRowView {
  const claim = row.claim;
  const base = {
    key: row.key,
    deadline: row.deadline,
    pace: row.pace,
    sentence: row.sentence,
  };

  switch (claim.kind) {
    case "lift": {
      const best = bestE1rmLbFor(claim.exerciseId, b);
      if (best === null) {
        return {
          ...base,
          title: claim.exerciseName,
          meter: null,
          line: { text: `Log ${claim.exerciseName} once to start tracking.`, tone: "muted" },
          since: null,
        };
      }

      // The ROUNDED e1RM, as `gapFor` uses: the figure on screen is the figure
      // the arithmetic uses, or "185 · 20 lb to go" stops adding up to 205.
      const now = Math.round(best);
      const toGo = claim.targetLb - now;
      const met = toGo <= 0;
      const weeks = weeksLeft(claim.byDate, b.today);

      const parts = [`e1RM ${now}`];
      if (met) parts.push("goal met");
      else {
        parts.push(`${toGo} lb to go`);
        if (weeks !== null) parts.push(`needs ${(toGo / weeks).toFixed(1)} lb/wk`);
      }

      return {
        ...base,
        title: claim.exerciseName,
        meter: {
          fraction: clamp01(now / claim.targetLb),
          met,
          nowLabel: String(now),
          targetLabel: `${fmtWeight(claim.targetLb)} lb`,
        },
        line: { text: parts.join(" · "), tone: met ? "good" : "ink" },
        since: null,
      };
    }

    case "bodyweight": {
      const now = currentWeightLb(b);
      const start = firstWeighIn(b);
      if (now === null || start === null) {
        return {
          ...base,
          title: "Bodyweight",
          meter: null,
          line: { text: "Weigh in to start tracking.", tone: "muted" },
          since: null,
        };
      }

      const target = claim.targetLb;
      /*
       * Met is judged in the goal's own direction from the start, not as
       * `now === target`: a cut that has overshot by two pounds is met, and so
       * is a bulk that has. Within a pound counts as met either way, matching
       * `gapFor` — the scale's daily noise is bigger than that.
       */
      const cutting = target < start.lb;
      const met = Math.abs(target - now) < 1 || (cutting ? now <= target : now >= target);

      const span = start.lb - target;
      const fraction = span === 0 ? (met ? 1 : 0) : clamp01((start.lb - now) / span);

      const toGo = target - now;
      const weeks = weeksLeft(claim.byDate, b.today);
      const parts = [`${Math.round(now)} now`];
      if (met) parts.push("goal met");
      else {
        parts.push(`${Math.abs(Math.round(toGo))} lb to go`);
        if (weeks !== null) parts.push(`needs ${signed(toGo / weeks, 1)} lb/wk`);
      }

      return {
        ...base,
        title: "Bodyweight",
        meter: {
          fraction: met ? 1 : fraction,
          met,
          nowLabel: String(Math.round(now)),
          targetLabel: `${fmtWeight(target)} lb`,
        },
        line: { text: parts.join(" · "), tone: met ? "good" : "ink" },
        since: `since ${formatShortDate(start.date)}`,
      };
    }

    /*
     * Rep and run goals: no bar, the existing gap line, under the headline the
     * owner would recognise. Nothing measurable to fill, so nothing filled.
     */
    default:
      return {
        ...base,
        title: row.headline,
        meter: null,
        line: row.gap,
        since: null,
      };
  }
}

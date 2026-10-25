/*
 * Relative imports, same reason as `model.ts`: this module has to be runnable
 * under the node-environment vitest config, and the only way to guarantee that
 * is to keep it free of `react-native` and of build configuration.
 */
import { WEEKLY_SET_TARGET, volumeStatus } from "../../lib/shared/muscles";
import { LOWER_BODY, averagePaceSecPerMile, detectInterference } from "../../lib/shared/running";
import type { Bootstrap, RankedMuscle } from "../../lib/types";
import { agrees, liftDaysIn, plural, refersTo, shiftIso } from "./model";

/**
 * One sentence: what to do in the next hour.
 *
 * This is the headline of the Today screen, and it leads because four concepts
 * with equal weight is the soup the owner complained about. One of them has to
 * be the answer and the other three have to be evidence for it.
 *
 * Everything below is a precedence ladder, first match wins, and it returns ONE
 * verdict — never two stacked sentences, never a list. The rungs are ordered by
 * what would change a decision: not enough data to say anything, then a
 * conflict the app can see and the owner cannot, then the session already in
 * progress, then volume debt gated on recovery.
 *
 * Voice rules, enforced by `verdict.test.ts` over every branch: no "maybe",
 * "consider", "you might", "it could be worth"; no exclamation mark; no praise.
 * A second clause after an em dash is allowed. The first rung is the only one
 * written as two sentences, because the admission and the instruction have to
 * be separable.
 */

export type VerdictTone = "ink" | "warn";

export interface Verdict {
  text: string;
  tone: VerdictTone;
}

/**
 * Lift days below which the screen has nothing to rank, so it says so.
 *
 * This was 5, matching the coach prompt's old refusal rule, and it was wrong
 * here for a different reason than it was wrong there. The coach was refusing
 * questions that needed no history; this line was suppressing the one output
 * the app exists to produce, for the whole of a new user's first month. With a
 * single logged day the owner saw "Not enough data to call it — 1 lift day in
 * four weeks" instead of "Chest is 10 sets short this week. Train chest."
 *
 * The distinction that decides it: volume debt is a COUNT, not a trend. Sets
 * per muscle over the last seven days is exact after one session — it is a
 * subtraction against `WEEKLY_SET_TARGET`, not an inference from a sample — so
 * there is no noise to pattern-match on and nothing to be thin about. Rungs 4
 * and 5 are therefore honest from day one.
 *
 * At zero days there is genuinely nothing: every muscle sits at 0 sets with a
 * null last-trained date, so `score` ties across all eighteen and whichever one
 * the server happened to sort first would be presented as a decision. That is
 * the only case this rung is for.
 *
 * Trend claims on this screen are gated separately and still need a real
 * sample — see the load chart and `estimateTdee`'s own floors. The coach's
 * five-day trend threshold lives in `THIN_SAMPLE_DAYS`.
 */
export const MIN_LIFT_DAYS = 1;
/** The window `MIN_LIFT_DAYS` is counted over. */
export const LIFT_DAY_WINDOW = 28;
/** A muscle below this score is not meaningfully owed sets. */
export const OWED_SCORE = 0.2;
/** Days before a muscle is ready for real work again. Matches `readiness.ts`. */
export const RECOVERED_DAYS = 2;

const isLowerBody = (muscle: string): boolean => (LOWER_BODY as string[]).includes(muscle);

const owed = (r: RankedMuscle): boolean => r.score > OWED_SCORE;

/** Never trained counts as recovered: there is nothing to recover from. */
const recovered = (r: RankedMuscle): boolean =>
  r.daysSinceTrained === null || r.daysSinceTrained >= RECOVERED_DAYS;

/** How many sets short of the bottom of the productive range a muscle is. */
const setsShort = (r: RankedMuscle): number =>
  Math.max(1, Math.round(WEEKLY_SET_TARGET.min - r.setsLast7d));

export function verdict(b: Bootstrap): Verdict {
  const ranked = b.volume.ranked;

  /*
   * `rankMuscles()` is NOT re-run here. `volume.ranked` is its output with
   * `status`, `reason` and `weakShare` dropped on the way over the wire, so
   * re-deriving the score on device would produce a second, slightly different
   * ranking (no `weakShare`) for the same muscle on the same day — and the
   * phone and the laptop would then disagree about what to train. The server's
   * `score` orders the list; `volumeStatus(setsLast7d)` is pure and complete,
   * so the status word is derived locally.
   */
  const top = ranked.length > 0 ? ranked[0] : null;

  /*
   * ---- 1. Nothing logged at all.
   *
   * Written as an empty state, not as a failure: what is missing, what appears
   * once it is there, and one action. No error tone, because an account on its
   * first day has done nothing wrong.
   */
  const liftDays = liftDaysIn(b.history.days, b.today, LIFT_DAY_WINDOW);
  if (liftDays < MIN_LIFT_DAYS) {
    return {
      text: "No sessions logged in four weeks. Log one and this line names the muscle "
        + "you owe the most sets to.",
      tone: "ink",
    };
  }

  // ---- 2. Interference. The one thing this app can say that a calorie app
  // cannot, because it holds both halves. Only fresh hits change today.
  const fresh = interferenceToday(b);
  if (fresh !== null) {
    const when = fresh.runDate === b.today ? "today" : "yesterday";
    const effort = fresh.effort === "long" ? "long" : "hard";
    const alternative = ranked.find((r) => owed(r) && !isLowerBody(r.muscle));

    return {
      text: alternative
        ? `You ran ${effort} ${when}. Legs on top of that is the trade — `
          + `do ${alternative.label} instead and squat Friday.`
        : `You ran ${effort} ${when}. Legs on top of that is the trade — `
          + "take the lower body work easy today; nothing else is behind.",
      tone: "warn",
    };
  }

  // ---- 3. Mid-session. The owner is standing in the gym holding a phone.
  if (b.activeWorkout !== null) {
    return {
      text: top && owed(top)
        ? `You're mid-session. ${top.label} ${agrees(top.label)} still ${plural(setsShort(top), "set")} `
          + "short this week."
        : "You're mid-session. Nothing's behind — finish on feel.",
      tone: "ink",
    };
  }

  // ---- 4 and 5. Volume debt, gated on recovery.
  if (top !== null && owed(top)) {
    if (recovered(top)) {
      const since = top.daysSinceTrained === null
        ? `you've never logged ${refersTo(top.label)}`
        : `you last hit ${refersTo(top.label)} ${plural(top.daysSinceTrained, "day")} ago`;
      return {
        text: `${top.label} ${agrees(top.label)} ${plural(setsShort(top), "set")} short this week and ${since}. `
          + `Train ${top.label}.`,
        tone: "ink",
      };
    }

    /*
     * Owed but trained inside 48 hours. Naming it anyway would be telling the
     * owner to do the one thing that will not work, so the sentence hands them
     * the best alternative that IS recovered — and admits there isn't one rather
     * than falling back to something that is already in range.
     */
    const alternative = ranked.find((r) => owed(r) && recovered(r));
    const trained = top.daysSinceTrained === 0 ? "today" : "yesterday";
    return {
      text: alternative
        ? `${top.label} ${agrees(top.label)} short but you trained ${refersTo(top.label)} ${trained}. Do ${alternative.label} instead.`
        : "Everything that's behind, you trained in the last 48 hours. Take today off.",
      tone: "ink",
    };
  }

  // ---- 6. Nothing owed. Note what this does NOT say: it does not congratulate
  // anybody, and it offers the day off as a real option rather than a reward.
  return {
    text: "Nothing's behind this week. Hardest honest session you feel like, or take the day.",
    tone: "ink",
  };
}

/**
 * Hard or long running in the last two days that collided with leg work.
 *
 * The runs are narrowed to today and yesterday BEFORE `detectInterference`,
 * not after: the hit list is sorted by run date and a six-week-old collision
 * would otherwise be the first thing found. The pace baseline still comes from
 * the whole 56-day array, because a two-run baseline is not a baseline — which
 * is exactly why `classifyRun` takes it as a parameter.
 */
function interferenceToday(b: Bootstrap) {
  const since = shiftIso(b.today, -1);
  const recent = b.runs.filter((r) => r.localDate >= since && r.localDate <= b.today);
  if (recent.length === 0) return null;

  const hits = detectInterference(
    recent,
    b.lowerBodyLiftDates,
    averagePaceSecPerMile(b.runs),
  );
  return hits.length > 0 ? hits[0] : null;
}

/**
 * The status word for a muscle, derived on device.
 *
 * Exported because the verdict is not the only place that needs it and because
 * it is the one piece of `Recommendation` the projection dropped that can be
 * recovered exactly — `volumeStatus` needs only `setsLast7d`, which did cross
 * the wire.
 */
export const statusOf = (r: RankedMuscle): ReturnType<typeof volumeStatus> =>
  volumeStatus(r.setsLast7d);

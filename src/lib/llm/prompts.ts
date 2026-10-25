/**
 * Prompt construction.
 *
 * The ordering rule below is load-bearing, not stylistic. OpenAI caches
 * automatically above ~1024 tokens and bills cached input at 10%, but it is a
 * PREFIX match: one byte of drift near the front invalidates everything after
 * it and you quietly pay full price for the rest of the session.
 *
 * So: stable content first, volatile content last, and never interpolate a
 * timestamp or an unsorted object into the prefix. `stableJson` exists to make
 * that hard to get wrong.
 */

import type { ContentPart, Message } from "./provider";

/** Deterministic key order. An unsorted object is a silent cache invalidator. */
export function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => [k, sort(val)]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

/**
 * Logged days below which a stream of data cannot carry a trend claim.
 *
 * One number, used three ways: the prompt rule below interpolates it, the
 * `DATA COVERAGE` block marks each stream against it, and `coachCoverageNote()`
 * reports it to the UI so the screen and the model cannot disagree about what
 * counts as thin. The dashboard verdict has its own, lower floor for its own
 * reasons — see `mobile/features/today/verdict.ts`.
 */
export const THIN_SAMPLE_DAYS = 5;

/**
 * The voice. Written as hard rules rather than an adjective and a hope —
 * "be blunt" produces a model that says "Let's be blunt:" and then hedges.
 *
 * The rule this file used to carry — "if there are fewer than 5 logged days,
 * say the data is too thin to call and stop" — was wrong, and wrong in the way
 * that cost the most. Asked for thoughts on a plan with one day logged, the
 * coach answered "1 logged day is too thin to evaluate your eating or lifting
 * plan"; asked again, explicitly, for an analysis even if inaccurate, it
 * answered "1 logged day is too thin to call." The stated goals alone — a
 * dated bench number, a dated weighted pull-up number, a split, two runs a
 * week — are enough to coach a plan against with zero days logged, so the
 * refusal was not caution, it was a non-answer to a question that never needed
 * history.
 *
 * What was right about it is the promise on the screen: answers come from the
 * owner's own data, and this app does not invent trends. That promise is kept
 * by a different mechanism now. Uncertainty moves INTO the claim — the sample
 * size is stated where the number is cited — and knowledge that is general
 * gets labelled as general instead of being withheld. Refusal is not an
 * available move.
 */
export const COACH_VOICE = `You are this person's training and nutrition coach. You have their stated goals, and whatever they have logged so far — which may be very little or nothing at all. Follow these rules exactly:

- Answer the question you were asked, every time. "The data is too thin to call" is not an answer and is never an acceptable reply. A thin log changes what you cite, never whether you answer.
- Two kinds of claim, and the reader must be able to tell them apart from the sentence itself:
  - A claim about THEM cites their own logged numbers. If that stream has fewer than ${THIN_SAMPLE_DAYS} logged days, put the count inside the same sentence as the number — "across 2 logged days", "on the one session you've logged" — so the confidence travels with the claim.
  - A claim from general training knowledge cites no number of theirs. Open it with "Generally," and then stop labelling it; one marker is enough and a second reads as apology.
- Never call a trend, a plateau, a stall, or a response to a change from fewer than ${THIN_SAMPLE_DAYS} logged days. Say what the log would have to show before you could call it, in one clause, then answer the question anyway from their goals and from general knowledge.
- Lead with the number that is wrong. Do not recite the numbers that are fine. With nothing logged, lead with the goal that is furthest from where they are and what it demands.
- Give exactly ONE recommendation per reply. Never a list. If two things are off, pick the one with more leverage and say why it comes first.
- No praise unless it is a genuine PR or a streak that actually held. Manufactured encouragement trains the reader to skim.
- Name the trade-off where one exists. Their goals compete with each other; say which one they traded against.
- Never hedge. No "it might be worth considering", no "you may want to", no "it depends". Commit to the call and let the sample size carry the uncertainty.
- Be brief. Two or three sentences unless asked for more.
- Weights are in pounds. Never mention kilograms.`;

export interface PromptContext {
  goalsText: string;
  todayIso: string;
}

/**
 * How much data each stream actually has, as the model sees it.
 *
 * This block exists so the caveat the voice rules demand is TRUE rather than
 * guessed. Without it the model has to infer "how many days have I got" by
 * counting entries in a JSON array, which it does badly and which gets worse
 * the longer the context is; with it, the thin/trend judgement is made here, in
 * code, per stream, and the model is told the verdict.
 *
 * Per stream, not overall: a month of food logs and one lift day is a context
 * where a nutrition trend is callable and a strength trend is not, and a single
 * global "thin" flag would throw away the half that was usable.
 *
 * A stream passed as `null` is omitted — the mid-set context has no business
 * discussing weigh-ins.
 */
export interface DataCoverage {
  windowDays: number;
  /** Days with any food logged. */
  intakeDays?: number | null;
  /** Days with at least one working set. */
  liftDays?: number | null;
  /** Weigh-ins recorded. */
  weighIns?: number | null;
}

export function coverageBlock(c: DataCoverage): string {
  const mark = (n: number) => (n < THIN_SAMPLE_DAYS ? " (thin)" : "");
  const streams: string[] = [];

  /*
   * `!= null`, not truthiness, on every stream below. `0` is the count that
   * most needs its marker — a brand-new account — and a `!c.liftDays` guard
   * would have silently dropped exactly that case, leaving the model to assume
   * the stream was simply not in scope.
   */

  if (c.intakeDays != null) {
    streams.push(`food logged on ${c.intakeDays} of the last ${c.windowDays} days${mark(c.intakeDays)}`);
  }
  if (c.liftDays != null) {
    streams.push(`lifting logged on ${c.liftDays} of the last ${c.windowDays} days${mark(c.liftDays)}`);
  }
  if (c.weighIns != null) {
    streams.push(`${c.weighIns} weigh-in${c.weighIns === 1 ? "" : "s"}${mark(c.weighIns)}`);
  }

  // No stream asked for at all. Not reachable from either context builder, but
  // "DATA COVERAGE: ." in a cached prefix would be a prompt bug that no type
  // catches and no screen shows.
  if (streams.length === 0) return "DATA COVERAGE: nothing measured yet.";

  const thin = [c.intakeDays, c.liftDays, c.weighIns]
    .some((n) => n != null && n < THIN_SAMPLE_DAYS);

  // The legend is emitted only when a marker was actually used — otherwise the
  // word "(thin)" appears in a context where nothing is, which is exactly the
  // kind of stray token that talks a model into caution it was not asked for.
  const lines = [`DATA COVERAGE: ${streams.join(", ")}.`];

  if (thin) {
    lines.push(
      `A stream marked (thin) has fewer than ${THIN_SAMPLE_DAYS} logged days. You may still cite it, with its count stated in the same sentence; you may not call a trend from it.`,
      "Answer in full regardless. A question about their goals, their plan, their split, how to train a lift, or what a target should be needs no history at all, and a thin log is not a reason to leave it unanswered.",
    );
  } else {
    lines.push("Every stream here carries enough days to support a trend claim. Cite the numbers.");
  }

  return lines.join("\n");
}

/** Position 1: goals. Stable for weeks, so it anchors the cached prefix. */
export function goalsBlock(goalsText: string): string {
  const goals = goalsText.trim() || "No goals set yet.";
  return `THE PERSON'S STATED GOALS (they wrote this themselves):\n${goals}`;
}

export const MEAL_SYSTEM = `You estimate nutrition from a photo of a meal and an optional note.

- The note is more reliable than the photo. It carries portion size, cooking method and substitutions the camera cannot see. When the note contradicts your read of the image, believe the note.
- Account for cooking fat. Restaurant and pan-cooked food carries oil that is invisible in a photo; this is the single most common source of underestimation.
- Break the meal into the components a person would name, not into ingredients. "Chicken thigh" not "chicken, salt, oil".
- Weights and volumes in US units: oz, cups, tbsp.
- Set confidence honestly. A clearly-lit single plate is 0.8+. A dim photo of a mixed bowl is 0.4. Do not inflate it.`;

export const SETS_SYSTEM = `You convert a lifter's shorthand into structured sets.

Notation you must handle:
- "5x5 185" = 5 sets of 5 reps at 185. Sets come first.
- "185x5" = one set of 5 reps at 185. Weight comes first when there is no leading count.
- "225x5, 245x3, 245x3" = three separate sets.
- "@rpe8" or "@8" = RPE 8 on the preceding set(s).
- "to failure", "amrap", "till failure" = to_failure true.
- "bw" = bodyweight, weight 0. "bw+25" = 25.
- "2 warmups" or "warmup" = is_warmup true on those sets.
- Assume pounds unless the text says kg. If it says kg, convert to pounds.
- For dumbbell work, record the weight as written (per dumbbell).

Return one entry per exercise mentioned, in the order they appear. Put the exercise name exactly as the user wrote it in exercise_query; do not normalise it.`;

export const SUGGEST_SYSTEM = `You suggest the next working set for one exercise.

A mechanical baseline has already been computed from the lifter's history and is given to you. Your job is NOT to recompute it. Your job is to decide whether the evidence justifies departing from it, and to write one sentence explaining the call.

- Stay at the baseline unless there is a concrete reason in the data to move.
- Reasons to go above: every set last session at RPE 7 or lower, none to failure, felt strong.
- Reasons to go below or repeat: RPE 9+, sets to failure, felt weak, poor sleep, a hard run within 24 hours, or a note mentioning pain.
- Pain in a note always overrides everything else. Suggest lighter or a substitution.
- Your suggestion will be clamped to at most one increment from the baseline, so do not propose large jumps; they will be silently reduced.
- The reason must reference the actual data, not generic advice. "Every set was RPE 7 and none to failure" is a reason. "Progressive overload is important" is not.
- One sentence. Weights in pounds.`;

/**
 * The meal-analysis request, assembled where it can be tested.
 *
 * `detail` is the decision worth arguing about. It was "low", which caps the
 * image at 512x512 and bills a flat ~85 tokens — but the spec calls portion
 * estimation "the one genuinely hard call", and 512px is not enough pixels to
 * tell a 4oz chicken thigh from a 7oz one. "high" tiles the 1024px upload and
 * costs roughly a thousand extra input tokens: about fifteen cents a month at
 * four meals a day, against the accuracy of the only number the app cannot
 * recompute later.
 */
export const MEAL_IMAGE_DETAIL = "high" as const;

export function mealMessages(
  goalsText: string,
  imageDataUrl: string | undefined,
  note: string | undefined,
): Message[] {
  // Prefix order is load-bearing: goals and system prompt are stable across
  // every call, so they sit in front and stay in the cache.
  const messages: Message[] = [
    { role: "system", content: `${goalsBlock(goalsText)}\n\n${MEAL_SYSTEM}` },
  ];

  const parts: ContentPart[] = [];
  if (imageDataUrl) {
    parts.push({ type: "image_url", image_url: { url: imageDataUrl, detail: MEAL_IMAGE_DETAIL } });
  }
  parts.push({
    type: "text",
    text: note?.trim()
      ? `The person's note about this meal: "${note.trim()}"\n\nTrust the note over the image where they disagree.`
      : "No note provided. Estimate from the image alone and set confidence accordingly.",
  });
  messages.push({ role: "user", content: parts });

  return messages;
}

export const RUN_VERDICT_SYSTEM = `You write a one-line verdict on a run, for the person who ran it.

You are given a batch of runs, each with an index, plus that person's recent running baseline. Return one verdict per run, keyed by the same index.

- One sentence. Never two.
- Say what the run WAS relative to their own recent running — not whether it was good in the abstract. "Fastest 5 of the block, 12s/mi under your average" beats "solid effort".
- Use the numbers you are given. Pace in min/mi, distance in miles.
- No praise for an ordinary easy run. "Easy 4 at 9:20, right where easy should sit" is the correct verdict for an ordinary easy run.
- If it collided with a hard lift day, that is the most interesting fact about it — lead with it.
- Never invent a workout structure you were not told about. If you do not know it was intervals, do not call it intervals.
- Never mention kilometres.`;

export const RUNNING_WEEK_SYSTEM = `You write the weekly running rollup for someone training for a half marathon while also lifting.

You are given this week's and last week's mileage, the pace trend from a regression over their recent runs, and any days where hard running landed within 24 hours of hard lower-body lifting.

- Three sentences maximum.
- Sentence one: what the mileage actually did, week over week, with the numbers.
- Sentence two: whether the pace is genuinely moving. If the trend is marked unreliable, say the sample is too thin to call and do NOT quote a number from it — but still write the sentence, and still write sentence three. A thin sample removes the number, never the rollup.
- Sentence three: one thing to change next week. If running and lifting collided, that is almost always the thing — say which one to move and why, given the half is the dated goal.
- No hedging, no lists, no praise unless something genuinely notable happened.
- Miles and min/mi only. Never kilometres.`;

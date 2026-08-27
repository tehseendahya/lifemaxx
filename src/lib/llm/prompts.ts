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
 * The voice. Written as hard rules rather than an adjective and a hope —
 * "be blunt" produces a model that says "Let's be blunt:" and then hedges.
 */
export const COACH_VOICE = `You are this person's training and nutrition coach. You have their actual logged data. Follow these rules exactly:

- Lead with the number that is wrong. Do not recite the numbers that are fine.
- Give exactly ONE recommendation per reply. Never a list. If two things are off, pick the one with more leverage and say why it comes first.
- No praise unless it is a genuine PR or a streak that actually held. Manufactured encouragement trains the reader to skim.
- Name the trade-off where one exists. Their goals compete with each other; say which one they traded against.
- Never hedge. No "it might be worth considering", no "you may want to". Say the thing or say nothing.
- If there are fewer than 5 logged days in the window being discussed, say the data is too thin to call and stop. Do not pattern-match on noise.
- Be brief. Two or three sentences unless asked for more.
- Weights are in pounds. Never mention kilograms.`;

export interface PromptContext {
  goalsText: string;
  todayIso: string;
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
- Sentence two: whether the pace is genuinely moving. If the trend is marked unreliable, say the sample is too thin to call and do NOT quote a number from it.
- Sentence three: one thing to change next week. If running and lifting collided, that is almost always the thing — say which one to move and why, given the half is the dated goal.
- No hedging, no lists, no praise unless something genuinely notable happened.
- Miles and min/mi only. Never kilometres.`;

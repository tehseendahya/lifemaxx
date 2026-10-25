import { describe, it, expect } from "vitest";

import {
  COACH_VOICE, MEAL_SYSTEM, RUNNING_WEEK_SYSTEM, RUN_VERDICT_SYSTEM, SETS_SYSTEM,
  SUGGEST_SYSTEM, THIN_SAMPLE_DAYS, coverageBlock, goalsBlock,
} from "./prompts";

/**
 * Prompt tests, with no model in the loop.
 *
 * A prompt cannot be unit-tested for the quality of what it produces — that
 * needs a live key and a human reading the output. What it CAN be tested for is
 * the property the owner actually lost money on: the prompt contained a rule
 * that told the coach to stop answering, so it stopped answering, twice in a
 * row, to a question that needed no history at all.
 *
 * So these assert the shape of the instruction rather than the shape of the
 * reply. They are regression tests against one specific sentence coming back:
 * "If there are fewer than 5 logged days in the window being discussed, say the
 * data is too thin to call and stop."
 *
 * `coverageBlock` is a different matter. It is a pure function over four
 * numbers and is tested as one.
 */

/** Every system prompt in the file, so a new one cannot skip the sweep. */
const ALL_PROMPTS: [string, string][] = [
  ["COACH_VOICE", COACH_VOICE],
  ["MEAL_SYSTEM", MEAL_SYSTEM],
  ["SETS_SYSTEM", SETS_SYSTEM],
  ["SUGGEST_SYSTEM", SUGGEST_SYSTEM],
  ["RUN_VERDICT_SYSTEM", RUN_VERDICT_SYSTEM],
  ["RUNNING_WEEK_SYSTEM", RUNNING_WEEK_SYSTEM],
];

describe("no prompt instructs the model to withhold an answer", () => {
  /*
   * Phrases that end a reply rather than qualify it. "too thin to call" is
   * deliberately NOT on this list: RUNNING_WEEK_SYSTEM uses it correctly, as a
   * caveat attached to one sentence of a rollup that still gets written. The
   * failure was never the admission, it was the full stop after it.
   */
  const withholding = [
    "and stop.",
    "and stop ",
    "do not answer",
    "decline to answer",
    "refuse",
    "say nothing",
    "say so and stop",
  ];

  for (const [name, prompt] of ALL_PROMPTS) {
    it(`${name} never tells the model to stop short`, () => {
      const lower = prompt.toLowerCase();
      for (const phrase of withholding) {
        expect(lower, `${name} contains "${phrase}"`).not.toContain(phrase);
      }
    });
  }

  it("the exact rule that produced two non-answers is gone", () => {
    expect(COACH_VOICE).not.toContain("the data is too thin to call and stop");
    expect(COACH_VOICE).not.toContain("Do not pattern-match on noise");
  });
});

describe("COACH_VOICE", () => {
  it("makes answering mandatory in so many words", () => {
    expect(COACH_VOICE).toContain("Answer the question you were asked, every time.");
    expect(COACH_VOICE).toContain("is never an acceptable reply");
  });

  it("keeps the anti-hallucination promise on trend claims specifically", () => {
    // The promise survives, narrowed from "any answer" to "a trend claim".
    expect(COACH_VOICE).toMatch(/Never call a trend, a plateau, a stall/);
    expect(COACH_VOICE).toContain("fewer than 5 logged days");
  });

  it("requires the sample size to travel inside the claim", () => {
    expect(COACH_VOICE).toContain("put the count inside the same sentence as the number");
  });

  it("gives general knowledge a marker, and only one", () => {
    expect(COACH_VOICE).toContain('Open it with "Generally,"');
    expect(COACH_VOICE).toContain("one marker is enough");
  });

  it("reads the trend threshold from THIN_SAMPLE_DAYS rather than hard-coding it", () => {
    // Both occurrences of the number in the prompt are interpolated, so moving
    // the constant moves the prompt and the DATA COVERAGE block together.
    const occurrences = COACH_VOICE.split(`fewer than ${THIN_SAMPLE_DAYS} logged days`).length - 1;
    expect(occurrences).toBe(2);
  });

  it("still forbids hedging, praise and lists", () => {
    expect(COACH_VOICE).toContain("Never hedge.");
    expect(COACH_VOICE).toContain("you may want to");
    expect(COACH_VOICE).toContain("Give exactly ONE recommendation per reply. Never a list.");
    expect(COACH_VOICE).toContain("No praise unless");
  });

  it("does not claim to have logged data that may not exist", () => {
    // "You have their actual logged data" was the opening line, and it is false
    // on a new account — which is where the refusals came from.
    expect(COACH_VOICE).not.toContain("You have their actual logged data");
    expect(COACH_VOICE).toContain("which may be very little or nothing at all");
  });

  it("keeps weights in pounds", () => {
    expect(COACH_VOICE).toContain("Weights are in pounds. Never mention kilograms.");
  });
});

describe("RUNNING_WEEK_SYSTEM keeps its caveat without dropping a sentence", () => {
  it("still demands all three sentences on a thin sample", () => {
    expect(RUNNING_WEEK_SYSTEM).toContain("still write the sentence, and still write sentence three");
    expect(RUNNING_WEEK_SYSTEM).toContain("A thin sample removes the number, never the rollup.");
  });
});

describe("coverageBlock", () => {
  const WINDOW = 14;

  it("marks each stream thin independently", () => {
    const text = coverageBlock({
      windowDays: WINDOW, intakeDays: 11, liftDays: 1, weighIns: 9,
    });
    expect(text).toContain("food logged on 11 of the last 14 days,");
    expect(text).toContain("lifting logged on 1 of the last 14 days (thin)");
    expect(text).toContain("9 weigh-ins.");
    // The rich stream must not inherit the thin one's marker: a month of food
    // logs and one lift day is a context where half the trends are callable.
    expect(text).not.toContain("food logged on 11 of the last 14 days (thin)");
  });

  it("tells the model to answer in full when anything is thin", () => {
    const text = coverageBlock({ windowDays: WINDOW, intakeDays: 1, liftDays: 1, weighIns: 1 });
    expect(text).toContain("Answer in full regardless.");
    expect(text).toContain("needs no history at all");
    expect(text).not.toContain("Cite the numbers.");
  });

  it("says the numbers are citable once every stream clears the floor", () => {
    const text = coverageBlock({ windowDays: WINDOW, intakeDays: 12, liftDays: 7, weighIns: 10 });
    expect(text).toContain("enough days to support a trend claim");
    expect(text).not.toContain("(thin)");
    expect(text).not.toContain("Answer in full regardless.");
  });

  it("treats the floor as exclusive, matching the prompt rule", () => {
    expect(coverageBlock({ windowDays: WINDOW, liftDays: THIN_SAMPLE_DAYS - 1 }))
      .toContain("(thin)");
    expect(coverageBlock({ windowDays: WINDOW, liftDays: THIN_SAMPLE_DAYS }))
      .not.toContain("(thin)");
  });

  it("omits a stream passed as null, so the mid-set context has no weigh-ins", () => {
    const text = coverageBlock({
      windowDays: WINDOW, liftDays: 2, intakeDays: null, weighIns: null,
    });
    expect(text).toContain("DATA COVERAGE: lifting logged on 2 of the last 14 days (thin).");
    expect(text).not.toContain("weigh-in");
    expect(text).not.toContain("food logged");
  });

  it("counts zero as thin rather than as absent", () => {
    // `0` is falsy; a `!c.liftDays` guard would have dropped the stream that
    // most needs the marker.
    expect(coverageBlock({ windowDays: WINDOW, liftDays: 0 }))
      .toContain("lifting logged on 0 of the last 14 days (thin)");
  });

  it("does not emit a heading with no streams under it", () => {
    expect(coverageBlock({ windowDays: WINDOW })).toBe("DATA COVERAGE: nothing measured yet.");
  });

  it("singularises one weigh-in", () => {
    expect(coverageBlock({ windowDays: WINDOW, weighIns: 1 })).toContain("1 weigh-in (thin)");
    expect(coverageBlock({ windowDays: WINDOW, weighIns: 6 })).toContain("6 weigh-ins");
  });
});

describe("goalsBlock", () => {
  it("passes the owner's prose through unchanged, since the coach reads it", () => {
    const goals = "Main lifts: 205 bench press by December, 225 by May.\nCurrent split: chest, side delts, and biceps";
    expect(goalsBlock(goals)).toContain(goals);
  });

  it("says so rather than leaving an empty heading", () => {
    expect(goalsBlock("   ")).toContain("No goals set yet.");
  });
});

import { describe, it, expect } from "vitest";

import { nonAnswerReason, MIN_ANSWER_WORDS } from "./non-answer";

/**
 * The detector, tested against the replies that caused the complaint.
 *
 * These two strings are what the owner actually received, on a real phone, from
 * the live model under the old prompt. A detector that does not fire on them is
 * decoration.
 */
const SHIPPED_NON_ANSWERS = [
  "1 logged day is too thin to evaluate your eating or lifting plan.",
  "1 logged day is too thin to call.",
];

describe("the replies the owner got", () => {
  for (const reply of SHIPPED_NON_ANSWERS) {
    it(`is flagged: "${reply}"`, () => {
      expect(nonAnswerReason(reply)).not.toBeNull();
    });
  }
});

describe("the shape the rewrite asks for passes", () => {
  it("accepts a caveat followed by a real recommendation", () => {
    const reply =
      "On one logged session I can't call a trend, so take this as a read on the plan rather than "
      + "on your progress: 205 by December is the binding goal and your split gives bench one "
      + "session a week. Move incline to a second bench day and keep the volume where it is.";
    expect(nonAnswerReason(reply)).toBeNull();
  });

  it("accepts an answer that labels itself as general knowledge", () => {
    const reply =
      "Generally, a bench that has to move 40 lb in two months needs two heavy exposures a week, "
      + "and your split gives it one. Split the chest day: heavy bench Monday, incline Thursday.";
    expect(nonAnswerReason(reply)).toBeNull();
  });

  it("accepts an answer with no caveat at all", () => {
    const reply =
      "Protein is the number that is wrong: 79 g against a 165 g target with the day nearly over. "
      + "Put 50 g in tonight's meal and stop worrying about the carbs.";
    expect(nonAnswerReason(reply)).toBeNull();
  });
});

describe("what makes a reply a non-answer", () => {
  it("is the stopping, not the admission", () => {
    // Same admission, in a reply that goes on to answer. Identical opening
    // clause to the flagged case above.
    const stops = "Not enough data to call it.";
    const continues =
      "Not enough data to call a trend yet — one session. The plan is the thing to fix: "
      + "205 by December needs two bench exposures a week and you have scheduled one.";

    expect(nonAnswerReason(stops)).not.toBeNull();
    expect(nonAnswerReason(continues)).toBeNull();
  });

  it("flags a reply that is too short regardless of what it says", () => {
    expect(nonAnswerReason("Train chest.")).not.toBeNull();
    expect(nonAnswerReason("")).toBe("empty reply");
    expect(nonAnswerReason("   ")).toBe("empty reply");
  });

  it("flags a long-ish admission that never commits to anything", () => {
    // Two sentences, but still under the word floor and still no recommendation.
    const reply = "One logged day is too thin to call. Log more days.";
    expect(nonAnswerReason(reply)).not.toBeNull();
  });

  it("explains which rule was broken", () => {
    expect(nonAnswerReason(SHIPPED_NON_ANSWERS[0]))
      .toContain("admits the data is thin and stops");
    expect(nonAnswerReason("Train chest.")).toContain("too short");
  });

  it("counts words, not characters, against the floor", () => {
    const admission = `too thin to call ${"x ".repeat(MIN_ANSWER_WORDS)}`;
    // Enough words to clear the floor, so the admission alone no longer trips
    // it — the floor is about whether an answer could fit, not about wording.
    expect(nonAnswerReason(`${admission}. And a second sentence here.`)).toBeNull();
  });
});

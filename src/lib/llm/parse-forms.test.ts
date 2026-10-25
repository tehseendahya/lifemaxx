import { describe, it, expect } from "vitest";
import { parseShorthand, type ParsedSet } from "./shorthand";

/**
 * The forms people actually type mid-workout, one test each.
 *
 * `shorthand.test.ts` covers the parser's own rules. This file covers the
 * question the free-text logging flow actually asks of it: for each way a
 * lifter writes a set on a phone between sets, do the numbers land in the right
 * FIELDS — and does it stay off the network while doing it.
 *
 * That second half is why every case asserts through `parseShorthand` and also
 * asserts that it returned something. A form that falls through to the model
 * still works, but it costs a round trip in a basement, and `usedModel` going
 * true is the regression signal: it means a form that used to be deterministic
 * now is not.
 *
 * A silently wrong field is the worst outcome available here. A parse failure
 * is visible and the user corrects it in the confirmation sheet; "5x5 185"
 * recorded as one set of 185 reps is not visible and corrupts the trend chart.
 * So these assert the full set list, not just that something parsed.
 */

/** Every case is one exercise, so this is the shape under test. */
function sets(input: string): ParsedSet[] {
  const entries = parseShorthand(input);
  expect(entries, `"${input}" must parse deterministically, with no model call`).toHaveLength(1);
  return entries[0].sets;
}

const plain = (reps: number, weight: number): ParsedSet =>
  ({ reps, weight_lb: weight, rpe: null, to_failure: false, is_warmup: false });

describe("sets × reps versus weight × reps — the one ambiguity that matters", () => {
  it("reads a leading count as sets: 5x5 185 is five sets of five", () => {
    expect(sets("bench 5x5 185")).toEqual(Array.from({ length: 5 }, () => plain(5, 185)));
  });

  it("reads weight first when there is no leading count: 185x5 is one set", () => {
    expect(sets("bench 185x5")).toEqual([plain(5, 185)]);
  });

  it("does not care about spaces around the x", () => {
    expect(sets("bench 185 x 5")).toEqual([plain(5, 185)]);
  });

  it("keeps 3x8 135 as three sets of eight, not eight sets of three", () => {
    const parsed = sets("bench 3x8 135");
    expect(parsed).toHaveLength(3);
    expect(parsed.every((s) => s.reps === 8 && s.weight_lb === 135)).toBe(true);
  });
});

describe("several sets in one line", () => {
  it("parses comma-separated sets at different weights", () => {
    expect(sets("squat 225x5, 245x3, 245x3")).toEqual([
      plain(5, 225), plain(3, 245), plain(3, 245),
    ]);
  });

  it("carries the previous weight through bare rep counts", () => {
    expect(sets("pullups bw+25 for 8, 8, 6")).toEqual([
      plain(8, 25), plain(8, 25), plain(6, 25),
    ]);
  });

  it('treats "and" as a set separator', () => {
    expect(sets("ohp 95x5 and 95x5")).toEqual([plain(5, 95), plain(5, 95)]);
  });
});

describe("RPE", () => {
  it("accepts @rpe8 and applies it to every set of the chunk", () => {
    const parsed = sets("bench 3x8 135 @rpe8");
    expect(parsed).toHaveLength(3);
    expect(parsed.every((s) => s.rpe === 8)).toBe(true);
  });

  it("accepts the bare @8 spelling", () => {
    expect(sets("bench 185x5 @8")[0].rpe).toBe(8);
  });

  it('accepts "rpe 9" written out', () => {
    expect(sets("bench 185x5 rpe 9")[0].rpe).toBe(9);
  });

  it("leaves rpe null when none was given rather than inventing one", () => {
    expect(sets("bench 185x5")[0].rpe).toBeNull();
  });
});

describe("flags", () => {
  it('sets to_failure for "to failure"', () => {
    expect(sets("lat pulldown 120x12 to failure")[0].to_failure).toBe(true);
  });

  it('sets to_failure for "amrap"', () => {
    expect(sets("curls 40x12 amrap")[0].to_failure).toBe(true);
  });

  it("marks warmups", () => {
    expect(sets("bench warmup 135x5")[0].is_warmup).toBe(true);
  });

  it("does not mark a normal set as a warmup", () => {
    expect(sets("bench 135x5")[0].is_warmup).toBe(false);
  });
});

describe("bodyweight", () => {
  it("records plain bw as zero added load", () => {
    expect(sets("dips bw for 12")).toEqual([plain(12, 0)]);
  });

  it("records bw+25 as the added load only, not a guessed bodyweight", () => {
    expect(sets("pullups bw+25 for 8")).toEqual([plain(8, 25)]);
  });
});

describe("units", () => {
  it("converts kg to lb when the weight is written in kg", () => {
    expect(sets("bench 100kg x 5")[0].weight_lb).toBeCloseTo(220.5, 1);
  });

  it("converts kg in the sets-first form too", () => {
    const parsed = sets("bench 5x5 100kg");
    expect(parsed).toHaveLength(5);
    expect(parsed.every((s) => Math.abs(s.weight_lb - 220.5) < 0.1)).toBe(true);
  });

  it("converts a spaced kg suffix", () => {
    expect(sets("squat 140 kg x 3")[0].weight_lb).toBeCloseTo(308.6, 1);
  });

  it("leaves an explicit lb suffix alone — the number is already pounds", () => {
    expect(sets("bench 185lbs x 5")).toEqual([plain(5, 185)]);
  });

  it('leaves "pounds" alone too', () => {
    expect(sets("bench 185 pounds x 5")).toEqual([plain(5, 185)]);
  });
});

describe("per-dumbbell weights", () => {
  it("records a dumbbell weight exactly as written, per dumbbell", () => {
    // Matching SETS_SYSTEM's rule. Doubling it here would make every dumbbell
    // e1RM in the app wrong, and halving the logged number would make the
    // plate-maths line wrong — so it is recorded as the user said it and the
    // interpretation lives downstream, in one place.
    expect(sets("incline dumbbell press 60x10")).toEqual([plain(10, 60)]);
  });

  it("keeps the multi-word name intact so resolution gets the whole phrase", () => {
    expect(parseShorthand("incline dumbbell press 60x10")[0].exercise_query)
      .toBe("incline dumbbell press");
  });
});

describe("several exercises at once", () => {
  it("splits a semicolon-separated line into one entry per exercise", () => {
    const entries = parseShorthand("bench 5x5 185; squat 225x5");
    expect(entries.map((e) => e.exercise_query)).toEqual(["bench", "squat"]);
    expect(entries[0].sets).toHaveLength(5);
    expect(entries[1].sets).toEqual([plain(5, 225)]);
  });

  it("splits newline-separated entries the same way", () => {
    const entries = parseShorthand("bench 5x5 185\nsquat 225x5\nohp 95x5");
    expect(entries.map((e) => e.exercise_query)).toEqual(["bench", "squat", "ohp"]);
  });

  it("rejects the whole input when one line is not understood, rather than logging half of it", () => {
    // `parseShorthand` is all-or-nothing on purpose. Half a workout silently
    // logged is worse than none of it: the user cannot see what is missing.
    expect(parseShorthand("bench 5x5 185\nsomething weird here")).toEqual([]);
  });
});

/**
 * The deterministic parser's boundary, asserted rather than assumed.
 *
 * Every case here is prose, returns nothing, and is therefore handed to the
 * model with `SETS_SYSTEM` — which is the designed path, not a gap. They are
 * pinned as tests because the temptation when reading this parser is to loosen
 * it until it swallows sentences, and that is how the forms above stop working.
 */
describe("prose falls through to the model", () => {
  const prose = [
    "did 3 sets weighted pull ups 45lbs for 6 reps",
    "weighted pull ups 45lbs for 6 reps",
    "bench 2 warmups 135x5",
    "bench 3x5 185 then squat 225x5",
    "did some pressing, felt heavy today",
    "what should I do next?",
  ];

  for (const input of prose) {
    it(`declines "${input}"`, () => {
      expect(parseShorthand(input)).toEqual([]);
    });
  }
});

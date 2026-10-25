import { describe, it, expect } from "vitest";
import {
  parseEntry,
  parseLines,
  parseShorthand,
  roundSetsToDisplayLb,
  SANITY,
  type ParsedEntry,
} from "./shorthand";

describe("shorthand parser", () => {
  it("parses sets x reps then weight", () => {
    const e = parseEntry("bench 5x5 185")!;
    expect(e.exercise_query).toBe("bench");
    expect(e.sets).toHaveLength(5);
    expect(e.sets[0]).toMatchObject({ reps: 5, weight_lb: 185 });
  });

  it("parses weight x reps as a single set", () => {
    const e = parseEntry("squat 225x5")!;
    expect(e.sets).toHaveLength(1);
    expect(e.sets[0]).toMatchObject({ reps: 5, weight_lb: 225 });
  });

  it("parses comma-separated sets of differing weights", () => {
    const e = parseEntry("squat 225x5, 245x3, 245x3")!;
    expect(e.sets).toHaveLength(3);
    expect(e.sets.map((s) => s.weight_lb)).toEqual([225, 245, 245]);
    expect(e.sets.map((s) => s.reps)).toEqual([5, 3, 3]);
  });

  it("carries RPE onto the set it follows", () => {
    const e = parseEntry("squat 225x5, 245x3 @rpe8")!;
    expect(e.sets[0].rpe).toBeNull();
    expect(e.sets[1].rpe).toBe(8);
  });

  it("accepts a bare @8", () => {
    expect(parseEntry("bench 185x5 @8")!.sets[0].rpe).toBe(8);
  });

  it("handles bodyweight plus load", () => {
    const e = parseEntry("pullups bw+25 for 8")!;
    expect(e.sets[0]).toMatchObject({ reps: 8, weight_lb: 25 });
  });

  it("handles plain bodyweight as zero", () => {
    expect(parseEntry("dips bw for 12")!.sets[0].weight_lb).toBe(0);
  });

  it("continues the previous weight for bare rep counts", () => {
    const e = parseEntry("pullups bw+25 for 8, 8, 6")!;
    expect(e.sets).toHaveLength(3);
    expect(e.sets.map((s) => s.reps)).toEqual([8, 8, 6]);
    expect(e.sets.every((s) => s.weight_lb === 25)).toBe(true);
  });

  it("flags sets taken to failure", () => {
    expect(parseEntry("curls 40x12 to failure")!.sets[0].to_failure).toBe(true);
  });

  it("flags warmups", () => {
    expect(parseEntry("bench warmup 135x5")!.sets[0].is_warmup).toBe(true);
  });

  it("converts kg to pounds", () => {
    const e = parseEntry("bench 100kg x 5")!;
    expect(e.sets[0].weight_lb).toBeCloseTo(220.5, 1);
  });

  it("keeps multi-word exercise names intact", () => {
    expect(parseEntry("incline dumbbell press 60x10")!.exercise_query)
      .toBe("incline dumbbell press");
  });

  it("parses several exercises across lines", () => {
    const entries = parseShorthand("bench 5x5 185\nsquat 225x5");
    expect(entries).toHaveLength(2);
    expect(entries[1].exercise_query).toBe("squat");
  });

  it("returns nothing for prose so the model can take over", () => {
    expect(parseEntry("did some pressing, felt heavy today")).toBeNull();
    expect(parseShorthand("what should I do next?")).toEqual([]);
  });

  it("returns nothing when the exercise name is missing", () => {
    expect(parseEntry("5x5 185")).toBeNull();
  });

  it("bails on a partially-understood line rather than guessing", () => {
    expect(parseEntry("bench 5x5 185, something weird here")).toBeNull();
  });
});

/**
 * Everything below was added after the owner used the app on a phone for the
 * first time and pasted five lines of real shorthand into "Type it". Nothing
 * here is hypothetical: each case is a form that came back empty, or a number
 * that came back wrong.
 */

const plain = (reps: number, weight: number) =>
  ({ reps, weight_lb: weight, rpe: null, to_failure: false, is_warmup: false });

describe("leading filler", () => {
  it('strips "today did" so the exercise is "bench", not "today did bench"', () => {
    expect(parseEntry("today did bench 165x5")!.exercise_query).toBe("bench");
  });

  it("strips each filler word on the documented list", () => {
    const cases = [
      ["today bench 185x5", "bench"],
      ["i did bench 185x5", "bench"],
      ["did bench 185x5", "bench"],
      ["then bench 185x5", "bench"],
      ["also bench 185x5", "bench"],
      ["and bench 185x5", "bench"],
      ["next bench 185x5", "bench"],
      ["finished with bench 185x5", "bench"],
    ] as const;
    for (const [input, expected] of cases) {
      expect(parseEntry(input)?.exercise_query, input).toBe(expected);
    }
  });

  it("leaves a real exercise name alone — the list is closed, not a stop-word heuristic", () => {
    // "press" and "row" are the names most at risk from an open stop-word list.
    expect(parseEntry("press 95x5")!.exercise_query).toBe("press");
    expect(parseEntry("row 135x8")!.exercise_query).toBe("row");
    expect(parseEntry("good morning 95x8")!.exercise_query).toBe("good morning");
    expect(parseEntry("incline smith press 155x7")!.exercise_query)
      .toBe("incline smith press");
  });

  it("does not turn filler-only prose into an entry", () => {
    expect(parseEntry("did some pressing, felt heavy today")).toBeNull();
    // Still declines the phrase SETS_SYSTEM owns: the count lands where the
    // exercise name should be, with or without the filler stripped.
    expect(parseEntry("did 3 sets weighted pull ups 45lbs for 6 reps")).toBeNull();
  });
});

describe('the "N sets" forms', () => {
  it('parses "N sets WxR" — 3 sets 155x7 is three sets of seven at 155', () => {
    const e = parseEntry("incline smith press 3 sets 155x7")!;
    expect(e.exercise_query).toBe("incline smith press");
    expect(e.sets).toEqual([plain(7, 155), plain(7, 155), plain(7, 155)]);
  });

  it('parses "N sets WkgxR" with the kg glued to the x', () => {
    const e = parseEntry("preacher curls 3 sets 30kgx8")!;
    expect(e.exercise_query).toBe("preacher curls");
    expect(e.sets).toHaveLength(3);
    expect(e.sets[0].reps).toBe(8);
    expect(e.sets[0].weight_lb).toBeCloseTo(66.1, 1);
  });

  it('parses "N sets Wkg for R"', () => {
    const e = parseEntry("pec deck 2 sets 20kg for 8")!;
    expect(e.exercise_query).toBe("pec deck");
    expect(e.sets).toHaveLength(2);
    expect(e.sets[0].reps).toBe(8);
    expect(e.sets[0].weight_lb).toBeCloseTo(44.1, 1);
  });

  it('accepts the singular "set" and an optional "of"', () => {
    expect(parseEntry("pec deck 1 set 90x12")!.sets).toEqual([plain(12, 90)]);
    expect(parseEntry("pec deck 3 sets of 90x12")!.sets)
      .toEqual([plain(12, 90), plain(12, 90), plain(12, 90)]);
  });

  it("carries RPE and flags onto every set of the group", () => {
    const e = parseEntry("preacher curls 3 sets 65x10 @rpe9 to failure")!;
    expect(e.sets).toHaveLength(3);
    expect(e.sets.every((s) => s.rpe === 9 && s.to_failure)).toBe(true);
  });
});

describe('"for R" as a reps form', () => {
  it("reads a weight-then-for pair", () => {
    expect(parseEntry("cable fly 40 for 15")!.sets).toEqual([plain(15, 40)]);
  });

  it('continues the previous weight through a bare "for R"', () => {
    const e = parseEntry("cable fly 40 for 15, for 12, 10")!;
    expect(e.sets).toEqual([plain(15, 40), plain(12, 40), plain(10, 40)]);
  });

  it('still declines a trailing "reps", which is prose the model owns', () => {
    expect(parseEntry("weighted pull ups 45lbs for 6 reps")).toBeNull();
  });
});

describe("sanity bounds", () => {
  it('drops the impossible chunk in "165x5, 165,5" instead of logging 165 reps', () => {
    // The typo the owner actually made. The "165" is unbelievable as a rep
    // count and is dropped; the "5" that follows it then continues the
    // previous weight, which reconstructs the set he meant.
    const e = parseEntry("bench 165x5, 165,5")!;
    expect(e.sets).toEqual([plain(5, 165), plain(5, 165)]);
    expect(e.dropped).toEqual(["165"]);
  });

  it("rejects a rep count above the documented ceiling", () => {
    expect(parseEntry(`pushups bw for ${SANITY.maxReps}`)!.sets[0].reps)
      .toBe(SANITY.maxReps);
    // One chunk, dropped, nothing left — so the line goes to the model rather
    // than coming back as a set nobody believes.
    expect(parseEntry(`pushups bw for ${SANITY.maxReps + 1}`)).toBeNull();
  });

  it("rejects zero reps", () => {
    expect(parseEntry("bench 185x0")).toBeNull();
  });

  it("rejects a weight above the documented ceiling", () => {
    expect(parseEntry(`leg press ${SANITY.maxWeightLb}x8`)!.sets[0].weight_lb)
      .toBe(SANITY.maxWeightLb);
    expect(parseEntry(`leg press ${SANITY.maxWeightLb + 1}x8`)).toBeNull();
  });

  it("rejects an absurd set count rather than minting that many rows", () => {
    expect(parseEntry(`bench ${SANITY.maxSetCount} sets 185x5`)!.sets)
      .toHaveLength(SANITY.maxSetCount);
    expect(parseEntry(`bench ${SANITY.maxSetCount + 1} sets 185x5`)).toBeNull();
  });

  it("keeps the good sets when only one chunk is out of bounds", () => {
    const e = parseEntry("bench 185x5, 9999x5, 185x5")!;
    expect(e.sets).toEqual([plain(5, 185), plain(5, 185)]);
    expect(e.dropped).toEqual(["9999x5"]);
  });

  it("leaves dropped absent when nothing was dropped", () => {
    expect(parseEntry("bench 185x5")!.dropped).toBeUndefined();
  });

  it("still fails the whole line for structure it does not recognise", () => {
    // The distinction that matters: an unbelievable NUMBER drops its chunk, an
    // unrecognised SHAPE fails the line so the model sees it whole.
    expect(parseEntry("bench 185x5, something weird here")).toBeNull();
  });
});

describe("multi-line input", () => {
  it("parses each line independently and concatenates the entries", () => {
    const entries = parseShorthand("bench 5x5 185\nsquat 225x5\nohp 95x5");
    expect(entries.map((e) => e.exercise_query)).toEqual(["bench", "squat", "ohp"]);
  });

  it("treats blank lines as separators, not errors", () => {
    const entries = parseShorthand("bench 185x5\n\n\nsquat 225x5\n");
    expect(entries.map((e) => e.exercise_query)).toEqual(["bench", "squat"]);
  });

  it("reports unreadable lines per line instead of poisoning the readable ones", () => {
    const results = parseLines("bench 5x5 185\nsomething weird here\nsquat 225x5");
    expect(results.map((r) => r.kind)).toEqual(["entry", "unparsed", "entry"]);
    expect(results[1]).toEqual({ kind: "unparsed", line: "something weird here" });
  });

  it("keeps parseShorthand all-or-nothing for callers with no model to fall back on", () => {
    expect(parseShorthand("bench 5x5 185\nsomething weird here")).toEqual([]);
  });
});

describe("rounding at the display edge", () => {
  it("rounds a kg-derived weight to a whole pound", () => {
    const e = parseEntry("preacher curls 3 sets 30kgx8")!;
    expect(roundSetsToDisplayLb(e.sets)[0].weight_lb).toBe(66);
    expect(roundSetsToDisplayLb(parseEntry("pec deck 2 sets 20kg for 8")!.sets)[0].weight_lb)
      .toBe(44);
  });

  it("leaves the parser's own precision alone so kg round-trips stay exact", () => {
    // Storage is kg; rounding in the parser would make 100kg read 220 lb and
    // break every existing kg assertion in this file and in parse-forms.
    expect(parseEntry("bench 100kg x 5")!.sets[0].weight_lb).toBeCloseTo(220.5, 1);
  });

  it("does not mutate its input", () => {
    const sets = parseEntry("preacher curls 30kgx8")!.sets;
    const before = sets[0].weight_lb;
    roundSetsToDisplayLb(sets);
    expect(sets[0].weight_lb).toBe(before);
  });
});

/**
 * The acceptance test for this round: the owner's paste, verbatim, including
 * the typo, the blank line and the three unsupported forms. Before this it
 * returned `[]` and the whole thing went to the model.
 */
describe("the owner's paste", () => {
  const PASTE = [
    "today did bench 165x5, 165,5, 175x3, 155x7",
    "incline smith press 3 sets 155x7",
    "pec deck 2 sets 20kg for 8",
    "",
    "preacher curls 3 sets 30kgx8",
    "cable rope hammer curls 3 sets 20kgx8",
  ].join("\n");

  const entries = parseShorthand(PASTE);

  it("parses entirely deterministically — no model call", () => {
    expect(entries).toHaveLength(5);
  });

  it("names all five exercises as typed, with the filler stripped", () => {
    expect(entries.map((e) => e.exercise_query)).toEqual([
      "bench",
      "incline smith press",
      "pec deck",
      "preacher curls",
      "cable rope hammer curls",
    ]);
  });

  it("reads line 1 as the four sets he meant, with the typo dropped not guessed", () => {
    expect(entries[0].sets).toEqual([
      plain(5, 165),
      plain(5, 165),
      plain(3, 175),
      plain(7, 155),
    ]);
    expect(entries[0].dropped).toEqual(["165"]);
  });

  it("reads the remaining four lines as whole pounds at the display edge", () => {
    const display = (e: ParsedEntry) =>
      roundSetsToDisplayLb(e.sets).map((s) => [s.reps, s.weight_lb]);

    expect(display(entries[1])).toEqual([[7, 155], [7, 155], [7, 155]]);
    expect(display(entries[2])).toEqual([[8, 44], [8, 44]]);
    expect(display(entries[3])).toEqual([[8, 66], [8, 66], [8, 66]]);
    expect(display(entries[4])).toEqual([[8, 44], [8, 44], [8, 44]]);
  });

  it("invents no RPE, no failure and no warmup anywhere", () => {
    const all = entries.flatMap((e) => e.sets);
    expect(all).toHaveLength(15); // 4 + 3 + 2 + 3 + 3
    expect(all.every((s) => s.rpe === null && !s.to_failure && !s.is_warmup)).toBe(true);
  });
});

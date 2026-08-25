import { describe, it, expect } from "vitest";
import { parseEntry, parseShorthand } from "./shorthand";

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

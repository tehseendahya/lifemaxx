import { describe, it, expect } from "vitest";
import { kgToLb, lbToKg, snapToLoadableKg, platesPerSide, formatWeight } from "./units";
import { epley, bestE1rm, totalVolumeKg, isReliableForStrength } from "./e1rm";
import { computeBaseline, clampSuggestion, detectPr, type PreviousSession } from "./progression";
import { hardSetsByMuscle, deriveWorkoutName, volumeStatus } from "./muscles";
import { weightTrend, estimateTdee, proposeTargets, proteinTargetG, type WeighIn } from "./tdee";
import { scoreMuscle, rankMuscles } from "./readiness";

describe("units", () => {
  it("round-trips lb and kg", () => {
    expect(lbToKg(kgToLb(100))).toBeCloseTo(100, 9);
  });

  it("converts a familiar plate load", () => {
    expect(kgToLb(lbToKg(225))).toBeCloseTo(225, 6);
  });

  it("snaps to loadable increments", () => {
    expect(snapToLoadableKg(84.1, 2.5)).toBeCloseTo(85, 6);
    expect(snapToLoadableKg(83.0, 2.5)).toBeCloseTo(82.5, 6);
  });

  it("computes plates for 225 on a 45lb bar", () => {
    expect(platesPerSide(lbToKg(225))).toEqual([45, 45]);
  });

  it("computes plates for 185", () => {
    expect(platesPerSide(lbToKg(185))).toEqual([45, 25]);
  });

  it("returns no plates for an empty bar", () => {
    expect(platesPerSide(lbToKg(45))).toEqual([]);
  });

  it("formats without trailing zeros", () => {
    expect(formatWeight(lbToKg(185), "lb")).toBe("185 lb");
  });
});

describe("e1rm", () => {
  it("matches Epley by hand", () => {
    // 100kg x 5 => 100 * (1 + 5/30) = 116.67
    expect(epley(100, 5)).toBeCloseTo(116.667, 3);
  });

  it("is identity at one rep", () => {
    expect(epley(140, 1)).toBeCloseTo(140 * (1 + 1 / 30), 6);
  });

  it("ignores warmups when picking the best set", () => {
    const best = bestE1rm([
      { weightKg: 200, reps: 5, isWarmup: true },
      { weightKg: 100, reps: 5 },
    ]);
    expect(best).toBeCloseTo(epley(100, 5), 6);
  });

  it("refuses to treat high-rep sets as strength", () => {
    expect(isReliableForStrength(20)).toBe(false);
    expect(bestE1rm([{ weightKg: 40, reps: 30 }])).toBeNull();
  });

  it("sums tonnage excluding warmups", () => {
    expect(totalVolumeKg([
      { weightKg: 100, reps: 5 },
      { weightKg: 100, reps: 5 },
      { weightKg: 60, reps: 10, isWarmup: true },
    ])).toBe(1000);
  });
});

describe("progression baseline", () => {
  const inc = 2.5;
  const session = (date: string, sets: Array<[number, number]>): PreviousSession => ({
    date,
    sets: sets.map(([weightKg, reps]) => ({ weightKg, reps })),
  });

  it("tells you to start when there's no history", () => {
    expect(computeBaseline([], inc).action).toBe("start");
  });

  it("adds weight when every set was completed", () => {
    const b = computeBaseline([session("2026-08-12", [[100, 5], [100, 5], [100, 5]])], inc);
    expect(b.action).toBe("increase");
    expect(b.weightKg).toBeCloseTo(102.5, 6);
  });

  it("repeats when a set came up short", () => {
    const b = computeBaseline([session("2026-08-12", [[100, 5], [100, 5], [100, 4]])], inc);
    expect(b.action).toBe("repeat");
    expect(b.weightKg).toBeCloseTo(100, 6);
  });

  it("repeats when you did fewer sets than prescribed", () => {
    const b = computeBaseline([session("2026-08-12", [[100, 5], [100, 5]])], inc);
    expect(b.action).toBe("repeat");
  });

  it("deloads after three stuck sessions at the same weight", () => {
    const b = computeBaseline([
      session("2026-08-12", [[100, 5], [100, 5], [100, 3]]),
      session("2026-08-05", [[100, 5], [100, 4], [100, 3]]),
      session("2026-07-29", [[100, 4], [100, 4], [100, 3]]),
    ], inc);
    expect(b.action).toBe("deload");
    expect(b.weightKg).toBeCloseTo(90, 6);
  });

  it("does not deload when the stall was at a different weight", () => {
    const b = computeBaseline([
      session("2026-08-12", [[100, 5], [100, 5], [100, 3]]),
      session("2026-08-05", [[95, 5], [95, 4], [95, 3]]),
      session("2026-07-29", [[95, 4], [95, 4], [95, 3]]),
    ], inc);
    expect(b.action).toBe("repeat");
  });
});

describe("suggestion guardrail", () => {
  it("passes through a modest suggestion", () => {
    const r = clampSuggestion(102.5, 100, 2.5);
    expect(r.clamped).toBe(false);
    expect(r.weightKg).toBe(102.5);
  });

  it("clamps an over-enthusiastic jump", () => {
    const r = clampSuggestion(140, 100, 2.5);
    expect(r.clamped).toBe(true);
    expect(r.weightKg).toBeCloseTo(102.5, 6);
  });

  it("clamps downward too", () => {
    const r = clampSuggestion(50, 100, 2.5);
    expect(r.clamped).toBe(true);
    expect(r.weightKg).toBeCloseTo(97.5, 6);
  });

  it("uses the smaller of increment and 10% on light lifts", () => {
    // baseline 10kg: 10% = 1kg, which is smaller than a 2.5kg increment.
    const r = clampSuggestion(20, 10, 2.5);
    expect(r.clamped).toBe(true);
    expect(r.weightKg).toBeLessThanOrEqual(11);
  });
});

describe("PR detection", () => {
  it("flags a new estimated 1RM", () => {
    const pr = detectPr(
      [{ weightKg: 105, reps: 5 }],
      [{ date: "2026-08-12", sets: [{ weightKg: 100, reps: 5 }] }],
    );
    expect(pr.kind).toBe("e1rm");
  });

  it("flags more reps at a weight you'd already done", () => {
    const pr = detectPr(
      [{ weightKg: 100, reps: 6 }],
      [{ date: "2026-08-12", sets: [{ weightKg: 100, reps: 5 }, { weightKg: 110, reps: 5 }] }],
    );
    expect(pr.kind).toBe("rep");
  });

  it("stays quiet on an ordinary session", () => {
    const pr = detectPr(
      [{ weightKg: 90, reps: 5 }],
      [{ date: "2026-08-12", sets: [{ weightKg: 100, reps: 5 }] }],
    );
    expect(pr.kind).toBeNull();
  });

  it("stays quiet when there is no history to beat", () => {
    expect(detectPr([{ weightKg: 100, reps: 5 }], []).kind).toBeNull();
  });
});

describe("muscle accounting", () => {
  const bench = [
    { muscle: "chest" as const, contribution: 1 },
    { muscle: "front_delt" as const, contribution: 0.5 },
    { muscle: "tricep" as const, contribution: 0.5 },
  ];

  it("sums fractional contributions", () => {
    const totals = hardSetsByMuscle([{ muscles: bench }, { muscles: bench }, { muscles: bench }]);
    expect(totals.get("chest")).toBe(3);
    expect(totals.get("tricep")).toBe(1.5);
  });

  it("excludes warmups", () => {
    const totals = hardSetsByMuscle([{ muscles: bench, isWarmup: true }, { muscles: bench }]);
    expect(totals.get("chest")).toBe(1);
  });

  it("names a push session", () => {
    expect(deriveWorkoutName(Array(4).fill({ muscles: bench }))).toContain("Push");
  });

  it("names a leg session", () => {
    const squat = [
      { muscle: "quad" as const, contribution: 1 },
      { muscle: "glute" as const, contribution: 0.5 },
    ];
    expect(deriveWorkoutName(Array(4).fill({ muscles: squat }))).toContain("Legs");
  });

  it("falls back to Workout with no sets", () => {
    expect(deriveWorkoutName([])).toBe("Workout");
  });

  it("classifies volume against the range", () => {
    expect(volumeStatus(4)).toBe("under");
    expect(volumeStatus(14)).toBe("in_range");
    expect(volumeStatus(26)).toBe("over");
  });
});

describe("weight trend regression", () => {
  it("recovers a known slope from evenly spaced points", () => {
    const w: WeighIn[] = [
      { localDate: "2026-08-01", weightKg: 80 },
      { localDate: "2026-08-08", weightKg: 79.3 },
      { localDate: "2026-08-15", weightKg: 78.6 },
    ];
    const t = weightTrend(w)!;
    expect(t.slopeKgPerDay).toBeCloseTo(-0.1, 6);
  });

  /**
   * The reason we don't use an EMA. These points sit on a perfectly straight
   * line but are unevenly spaced; regression must still recover the true slope.
   */
  it("is unbiased by irregular weigh-in spacing", () => {
    const w: WeighIn[] = [
      { localDate: "2026-08-03", weightKg: 80.0 },
      { localDate: "2026-08-04", weightKg: 79.9 },
      { localDate: "2026-08-05", weightKg: 79.8 },
      { localDate: "2026-08-17", weightKg: 78.6 },
    ];
    const t = weightTrend(w)!;
    expect(t.slopeKgPerDay).toBeCloseTo(-0.1, 6);
  });

  it("returns null with a single reading", () => {
    expect(weightTrend([{ localDate: "2026-08-01", weightKg: 80 }])).toBeNull();
  });

  it("returns null when every reading is the same day", () => {
    expect(weightTrend([
      { localDate: "2026-08-01", weightKg: 80 },
      { localDate: "2026-08-01", weightKg: 80.4 },
    ])).toBeNull();
  });
});

describe("TDEE estimation", () => {
  const weighIns = (n: number, startKg: number, perDay: number): WeighIn[] =>
    Array.from({ length: n }, (_, i) => ({
      localDate: new Date(Date.UTC(2026, 7, 1 + i * 3)).toISOString().slice(0, 10),
      weightKg: startKg + perDay * i * 3,
    }));

  const intake = (n: number, kcal: number) =>
    Array.from({ length: n }, (_, i) => ({
      localDate: new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10),
      kcal,
    }));

  it("refuses to guess below the sample floor", () => {
    const r = estimateTdee(weighIns(5, 80, -0.02), intake(28, 2400));
    expect(r.status).toBe("insufficient_data");
    if (r.status === "insufficient_data") expect(r.needed).toBe(8);
  });

  it("refuses to guess without enough intake days", () => {
    expect(estimateTdee(weighIns(10, 80, -0.02), intake(3, 2400)).status).toBe("insufficient_data");
  });

  it("reads maintenance straight off a flat weight trend", () => {
    const r = estimateTdee(weighIns(10, 80, 0), intake(28, 2400));
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.tdee).toBeCloseTo(2400, 0);
  });

  it("computes a higher TDEE than intake when weight is falling", () => {
    // Losing 0.5 kg/week on 2400 kcal => TDEE ~ 2400 + 7700*0.5/7 = 2950
    const r = estimateTdee(weighIns(12, 80, -0.5 / 7), intake(28, 2400));
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.tdee).toBeGreaterThan(2900);
      expect(r.tdee).toBeLessThan(3000);
      expect(r.trendKgPerWeek).toBeCloseTo(-0.5, 3);
    }
  });

  it("computes a lower TDEE than intake when weight is rising", () => {
    const r = estimateTdee(weighIns(12, 80, 0.25 / 7), intake(28, 3000));
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.tdee).toBeLessThan(3000);
  });
});

describe("target proposals", () => {
  it("orders cut below maintain below bulk", () => {
    const t = proposeTargets(2600, 80);
    expect(t.cut).toBeLessThan(t.maintain);
    expect(t.maintain).toBeLessThan(t.bulk);
  });

  it("keeps the cut deficit sane for the bodyweight", () => {
    const t = proposeTargets(2600, 80);
    expect(2600 - t.cut).toBeGreaterThan(300);
    expect(2600 - t.cut).toBeLessThan(600);
  });

  it("scales protein with bodyweight", () => {
    expect(proteinTargetG(80)).toBe(144);
  });
});

describe("readiness ranking", () => {
  it("ranks an untrained, under-worked muscle first", () => {
    const ranked = rankMuscles([
      { muscle: "chest", setsLast7d: 16, daysSinceTrained: 3 },
      { muscle: "rear_delt", setsLast7d: 2, daysSinceTrained: 6 },
    ]);
    expect(ranked[0].muscle).toBe("rear_delt");
  });

  it("gates a muscle trained today regardless of debt", () => {
    const fresh = scoreMuscle({ muscle: "lat", setsLast7d: 0, daysSinceTrained: 0 });
    const rested = scoreMuscle({ muscle: "lat", setsLast7d: 0, daysSinceTrained: 4 });
    expect(fresh).toBe(0);
    expect(rested).toBeGreaterThan(fresh);
  });

  it("scores an in-range muscle at zero debt", () => {
    expect(scoreMuscle({ muscle: "quad", setsLast7d: 14, daysSinceTrained: 5 })).toBe(0);
  });

  it("penalises an overworked muscle", () => {
    const over = scoreMuscle({ muscle: "chest", setsLast7d: 25, daysSinceTrained: 5 });
    expect(over).toBe(0);
  });

  it("treats a never-trained muscle as maximally due", () => {
    const never = scoreMuscle({ muscle: "calf", setsLast7d: 0, daysSinceTrained: null });
    expect(never).toBeCloseTo(1, 6);
  });

  it("nudges down a muscle that felt weak", () => {
    const normal = scoreMuscle({ muscle: "lat", setsLast7d: 0, daysSinceTrained: 4 });
    const weak = scoreMuscle({ muscle: "lat", setsLast7d: 0, daysSinceTrained: 4, weakShare: 1 });
    expect(weak).toBeLessThan(normal);
  });
});

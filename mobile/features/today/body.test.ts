import { describe, expect, it } from "vitest";

import { TODAY, bootstrap, day, emptyBootstrap, threeWeighIns } from "./fixture";
import { bodyCard, bodyweightGoalDirection, intakeSentence, recentIntakeMean, trendWeightLb } from "./body";
import { shiftIso } from "./model";
import type { HistoryDay } from "../../lib/types";

/**
 * The Body card that replaced Trajectory. Its contract: absent on day one, one
 * chart from two weigh-ins, maintenance and one intake sentence once measured.
 */

/** Seven completed days of intake ending yesterday, at `kcal` each. */
const week = (kcal: number, extra: HistoryDay[] = []): HistoryDay[] => [
  ...Array.from({ length: 7 }, (_, i) =>
    day(shiftIso(TODAY, -(i + 1)), { kcal, weightLb: 182 - (i % 2) })),
  ...extra,
].sort((a, b) => a.date.localeCompare(b.date));

describe("visibility", () => {
  it("is absent on day one", () => {
    expect(bodyCard(emptyBootstrap())).toBeNull();
  });

  it("is absent at one weigh-in", () => {
    expect(bodyCard(emptyBootstrap({
      history: { days: [day(TODAY, { weightLb: 182 })], mainLifts: [] },
    }))).toBeNull();
  });
});

describe("partial: weigh-ins but no maintenance yet", () => {
  it("is one chart under a trend weight and a rate, with no maintenance column", () => {
    const card = bodyCard(threeWeighIns())!;
    expect(card.mode).toBe("partial");
    expect(card.label).toBe("Body · 28 days");
    expect(card.stats.map((s) => s.label)).toEqual(["TREND WEIGHT", "RATE"]);
    expect(card.chart.values).toEqual([183, 182, 182]);
    expect(card.xLabels).toEqual({ left: "23 Oct", right: "TODAY" });
    expect(card.sentence).toBeNull();
  });

  it("prints the fitted trend weight, not the last reading", () => {
    // 183, 182, 182 over three days fits to 181.83 at the last point — not 182.
    const card = bodyCard(threeWeighIns())!;
    expect(card.stats[0].value).toBe("181.8 lb");
    expect(card.stats[1].value).toBe("−3.5 lb/wk");
  });
});

describe("full: maintenance measured", () => {
  const full = (kcal: number, goalsText = "") => bootstrap({
    goalsText,
    history: { days: week(kcal), mainLifts: [] },
  });

  it("adds maintenance to the stats with its margin as the hint", () => {
    const card = bodyCard(full(2200))!;
    expect(card.mode).toBe("full");
    expect(card.stats[2]).toEqual({ label: "MAINTENANCE", value: "2377", hint: "±11" });
    // The server's fitted weight, not the on-device one.
    expect(card.stats[0].value).toBe("181.0 lb");
  });

  it("says a deficit with a minus sign and a loss rate", () => {
    expect(bodyCard(full(2200))!.sentence).toEqual({
      text: "Eating 2200 a day against 2377 maintenance, −177 kcal/day, about −0.4 lb/wk.",
      tone: "muted",
    });
  });

  it("says a surplus with a plus sign and a gain rate", () => {
    expect(bodyCard(full(2700))!.sentence!.text)
      .toBe("Eating 2700 a day against 2377 maintenance, +323 kcal/day, about +0.6 lb/wk.");
  });

  it("warns only when intake points away from a written bodyweight goal", () => {
    // Fixture weight ~181 lb. A cut goal and a surplus contradict.
    expect(bodyCard(full(2700, "Cut to 170 lb by March"))!.sentence!.tone).toBe("warn");
    // A cut goal and a deficit agree.
    expect(bodyCard(full(2200, "Cut to 170 lb by March"))!.sentence!.tone).toBe("muted");
    // A bulk goal and a deficit contradict.
    expect(bodyCard(full(2200, "Bulk up to 190 lb"))!.sentence!.tone).toBe("warn");
    // No goal, no wrong direction.
    expect(bodyCard(full(2700))!.sentence!.tone).toBe("muted");
  });

  it("does not call logging noise a contradiction", () => {
    // +23 kcal/day on a cut is rounding, not a direction.
    expect(bodyCard(full(2400, "Cut to 170 lb by March"))!.sentence!.tone).toBe("muted");
  });

  it("drops the sentence below three logged days rather than averaging two", () => {
    const b = bootstrap({
      history: {
        days: [
          day("2026-10-20", { weightLb: 182 }),
          day("2026-10-23", { weightLb: 181, kcal: 2200 }),
          day("2026-10-24", { weightLb: 181, kcal: 2300 }),
        ],
        mainLifts: [],
      },
    });
    expect(bodyCard(b)!.sentence).toBeNull();
  });
});

describe("the intake mean", () => {
  it("leaves today's half-eaten day out", () => {
    const b = bootstrap({ history: { days: week(2200, [day(TODAY, { kcal: 400 })]), mainLifts: [] } });
    expect(recentIntakeMean(b)).toBe(2200);
  });

  it("excludes unlogged days rather than counting them as zero", () => {
    const days = [
      day("2026-10-22", { kcal: 2000 }),
      day("2026-10-23", { kcal: 2400 }),
      day("2026-10-24", { kcal: 2200 }),
    ];
    expect(recentIntakeMean(bootstrap({ history: { days, mainLifts: [] } }))).toBe(2200);
  });

  it("returns the sentence's maths unchanged for any TDEE", () => {
    const b = bootstrap({ history: { days: week(2500), mainLifts: [] } });
    expect(intakeSentence(b, 2500)!.text)
      .toBe("Eating 2500 a day against 2500 maintenance, 0 kcal/day, about 0.0 lb/wk.");
  });
});

describe("helpers", () => {
  it("falls back to the last raw reading with one weigh-in", () => {
    const b = emptyBootstrap({ history: { days: [day(TODAY, { weightLb: 182 })], mainLifts: [] } });
    expect(trendWeightLb(b)).toBe(182);
  });

  it("reads no direction without a bodyweight goal", () => {
    expect(bodyweightGoalDirection(bootstrap())).toBe(0);
    expect(bodyweightGoalDirection(bootstrap({ goalsText: "Cut to 170 lb" }))).toBe(-1);
  });
});

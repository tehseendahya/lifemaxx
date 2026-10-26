import { describe, expect, it } from "vitest";

import { TODAY, bootstrap, day, emptyBootstrap, liftHistory, ranked } from "./fixture";
import { dailyChecks, heroAction, owedChips } from "./hero";
import { EMPTY_VERDICT, verdict } from "./verdict";

/**
 * The hero card's decisions: the three daily marks, the owed chips and the
 * button. The sentence is `verdict.ts`'s and is tested there; it is asserted
 * here only where the hero depends on which rung answered.
 */

const active = { id: "w1", startedAt: "2026-10-25T16:00:00.000Z" };

describe("day one", () => {
  it("reads rung 1, START LIFT, three unchecked marks and no chips", () => {
    const b = emptyBootstrap();
    const call = verdict(b);

    expect(call.text).toBe(EMPTY_VERDICT);
    expect(heroAction(b, call)).toEqual({ label: "START LIFT", variant: "primary" });
    expect(dailyChecks(b)).toEqual([
      { key: "weigh", done: false, text: "Weigh in" },
      { key: "food", done: false, text: "Log food" },
      { key: "train", done: false, text: "Train" },
    ]);
    // The ranking is not empty on day one — every muscle scores 1 — so this is
    // the rung-1 guard working, not an empty list.
    expect(b.volume.ranked.length).toBeGreaterThan(0);
    expect(owedChips(b)).toEqual([]);
  });
});

describe("dailyChecks", () => {
  describe("food", () => {
    it("shows protein left after the first meal", () => {
      // Fixture: target 165 g, eaten 79 g, two meals.
      expect(dailyChecks(bootstrap())[1]).toEqual({
        key: "food", done: true, text: "86 g protein left",
      });
    });

    it("says protein hit at or past the target", () => {
      const exact = bootstrap({ totals: { kcal: 2000, proteinG: 165, carbsG: 0, fatG: 0 } });
      expect(dailyChecks(exact)[1].text).toBe("protein hit");

      const over = bootstrap({ totals: { kcal: 2000, proteinG: 190, carbsG: 0, fatG: 0 } });
      expect(dailyChecks(over)[1].text).toBe("protein hit");
    });

    it("never prints 0 g left for a fraction of a gram", () => {
      const close = bootstrap({ totals: { kcal: 2000, proteinG: 164.6, carbsG: 0, fatG: 0 } });
      expect(dailyChecks(close)[1].text).toBe("protein hit");
    });

    it("says Log food before any meal, whatever the totals say", () => {
      const none = bootstrap({ mealCount: 0 });
      expect(dailyChecks(none)[1]).toEqual({ key: "food", done: false, text: "Log food" });
    });

    it("never prints kcal", () => {
      expect(JSON.stringify(dailyChecks(bootstrap()))).not.toContain("kcal");
    });
  });

  describe("weigh", () => {
    it("fills with today's weigh-in", () => {
      const b = bootstrap({ history: { days: [day(TODAY, { weightLb: 182 })], mainLifts: [] } });
      expect(dailyChecks(b)[0]).toEqual({ key: "weigh", done: true, text: "182 lb" });
    });

    it("ignores yesterday's", () => {
      const b = bootstrap({ history: { days: [day("2026-10-24", { weightLb: 182 })], mainLifts: [] } });
      expect(dailyChecks(b)[0].done).toBe(false);
    });

    it("fills immediately from a weigh-in typed on this phone", () => {
      expect(dailyChecks(emptyBootstrap(), 182.4)[0])
        .toEqual({ key: "weigh", done: true, text: "182.4 lb" });
    });
  });

  describe("train", () => {
    it("counts today's working sets", () => {
      const b = bootstrap({ history: { days: [day(TODAY, { hardSets: 14 })], mainLifts: [] } });
      expect(dailyChecks(b)[2]).toEqual({ key: "train", done: true, text: "14 sets" });
    });

    it("singularises one set", () => {
      const b = bootstrap({ history: { days: [day(TODAY, { hardSets: 1 })], mainLifts: [] } });
      expect(dailyChecks(b)[2].text).toBe("1 set");
    });

    it("is done while a session is running, before its first set lands", () => {
      expect(dailyChecks(bootstrap({ activeWorkout: active }))[2])
        .toEqual({ key: "train", done: true, text: "in session" });
    });
  });
});

describe("owedChips", () => {
  it("names up to two owed muscles with how short they are", () => {
    // Fixture ranking: Rear Delts 0 sets (score 1), Lats 1.5 (0.765), Chest 8
    // (0.2001 — just over the floor), Quads 12 (0.05).
    expect(owedChips(bootstrap())).toEqual(["Rear Delts · 10 short", "Lats · 9 short"]);
  });

  it("skips anything at or below the owed floor", () => {
    const b = bootstrap({
      volume: { summary: "", ranked: [ranked({ score: 0.2 }), ranked({ label: "Lats", score: 0.1 })] },
    });
    expect(owedChips(b)).toEqual([]);
  });

  it("is hidden on rung 1 even when muscles score as owed", () => {
    expect(owedChips(bootstrap({ history: { days: [], mainLifts: [] } }))).toEqual([]);
  });
});

describe("heroAction", () => {
  it("resumes a running session", () => {
    const b = bootstrap({ activeWorkout: active, history: { days: liftHistory(), mainLifts: [] } });
    expect(heroAction(b, verdict(b))).toEqual({ label: "RESUME SESSION", variant: "primary" });
  });

  it("starts a lift when something is owed", () => {
    const b = bootstrap();
    expect(heroAction(b, verdict(b))).toEqual({ label: "START LIFT", variant: "primary" });
  });

  it("offers a secondary LOG A LIFT ANYWAY on the take-today-off rung", () => {
    const b = bootstrap({
      volume: {
        summary: "",
        ranked: [ranked({ muscle: "chest", label: "Chest", score: 1, daysSinceTrained: 1 })],
      },
    });
    expect(verdict(b).kind).toBe("rest");
    expect(heroAction(b, verdict(b))).toEqual({ label: "LOG A LIFT ANYWAY", variant: "secondary" });
  });

  it("and on the nothing's-behind rung", () => {
    const b = bootstrap({ volume: { summary: "", ranked: [ranked({ setsLast7d: 16, score: 0.1 })] } });
    expect(heroAction(b, verdict(b)).label).toBe("LOG A LIFT ANYWAY");
  });
});

import { describe, expect, it } from "vitest";

import { mergeHistoryDays } from "./history";

/**
 * The one rule worth asserting here: a day with nothing logged is ABSENT, and a
 * day present for one reason carries honest nulls for the other two. The Today
 * charts draw a gap as nothing and never interpolate across one, so if this
 * ever zero-filled, "I did not weigh in" would render as "I weighed nothing".
 */
describe("mergeHistoryDays", () => {
  it("unions three sparse series into one ascending array", () => {
    const days = mergeHistoryDays(
      [{ localDate: "2026-10-20", weightKg: 82.5 }, { localDate: "2026-10-22", weightKg: 82.1 }],
      [{ localDate: "2026-10-22", kcal: 2400 }, { localDate: "2026-10-23", kcal: 2100 }],
      [{ localDate: "2026-10-21", hardSets: 18 }],
    );

    expect(days.map((d) => d.date)).toEqual([
      "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23",
    ]);
    // 82.5 kg is 181.88 lb — whole pounds, as the owner asked for.
    expect(days[0]).toEqual({ date: "2026-10-20", weightLb: 182, kcal: null, hardSets: 0 });
    expect(days[1]).toEqual({ date: "2026-10-21", weightLb: null, kcal: null, hardSets: 18 });
    expect(days[2]).toEqual({ date: "2026-10-22", weightLb: 181, kcal: 2400, hardSets: 0 });
    expect(days[3]).toEqual({ date: "2026-10-23", weightLb: null, kcal: 2100, hardSets: 0 });
  });

  it("leaves days with nothing logged out entirely", () => {
    const days = mergeHistoryDays([], [], [{ localDate: "2026-10-21", hardSets: 4 }]);
    expect(days).toHaveLength(1);
  });

  it("treats a zero-kcal day as no intake data rather than a zero-calorie day", () => {
    const [day] = mergeHistoryDays([], [{ localDate: "2026-10-21", kcal: 0 }], [{ localDate: "2026-10-21", hardSets: 2 }]);
    expect(day.kcal).toBeNull();
  });

  it("is empty for an account that has logged nothing", () => {
    expect(mergeHistoryDays([], [], [])).toEqual([]);
  });
});

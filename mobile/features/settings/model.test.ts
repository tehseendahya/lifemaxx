import { describe, expect, it } from "vitest";

import {
  MAX_WEIGHT_LB, MIN_WEIGHT_LB, buildMaintenance, buildWeighIn,
  describeReachability, weightFromPad,
} from "./model";
import type { Bootstrap } from "../../lib/types";
import type { TdeeResult } from "../../lib/shared/tdee";

/**
 * The real shapes, trimmed to what these functions read. Everything else in
 * `Bootstrap` is irrelevant here and a full fixture would hide which fields
 * actually drive the output.
 */
function bootstrap(over: {
  tdee?: TdeeResult;
  targetKcal?: number | null;
}): Bootstrap {
  const tdee: TdeeResult = over.tdee ?? {
    status: "ok",
    tdee: 2377,
    marginKcal: 11,
    trendKgPerWeek: -0.16431483055858312,
    currentKg: 82.08537140127595,
    meanIntake: 2196,
    weighIns: 13,
  };

  return {
    today: "2026-10-25",
    tz: "America/New_York",
    goalsText: "Half marathon in the fall.",
    target: {
      kcal: over.targetKcal === undefined ? 2600 : over.targetKcal,
      proteinG: 165,
      carbsG: 300,
      fatG: 80,
      mode: over.targetKcal === null ? "calibrating" : "maintain",
    },
    totals: { kcal: 1375, proteinG: 79, carbsG: 115, fatG: 68 },
    mealCount: 2,
    volume: { summary: "", ranked: [] },
    tdee,
    activeWorkout: null,
    runs: [],
    lowerBodyLiftDates: [],
    gyms: [],
    catalogue: [],
    lastSets: {},
    // Not what this suite is about; the Today dashboard owns `history`.
    history: { days: [], mainLifts: [] },
  };
}

const insufficient: TdeeResult = { status: "insufficient_data", weighIns: 5, needed: 8 };

describe("buildMaintenance", () => {
  it("shows the measured number, its margin and a signed trend when status is ok", () => {
    const m = buildMaintenance(bootstrap({}));
    expect(m.status).toBe("ok");
    if (m.status !== "ok") throw new Error("unreachable");

    expect(m.tdee).toBe("2377");
    expect(m.hint).toBe("±11 kcal · from 13 weigh-ins");
    // -0.164 kg/wk is -0.36 lb/wk. Negative means losing, and the sign is the
    // whole content of the figure.
    expect(m.trend).toBe("-0.4 lb/wk");
  });

  it("signs a gaining trend explicitly", () => {
    const m = buildMaintenance(bootstrap({
      tdee: {
        status: "ok", tdee: 2900, marginKcal: 40, trendKgPerWeek: 0.2,
        currentKg: 80, meanIntake: 3100, weighIns: 11,
      },
    }));
    if (m.status !== "ok") throw new Error("unreachable");
    expect(m.trend).toBe("+0.4 lb/wk");
  });

  it("offers no proposal while a target is already set", () => {
    const m = buildMaintenance(bootstrap({ targetKcal: 2600 }));
    if (m.status !== "ok") throw new Error("unreachable");
    expect(m.proposal).toBeNull();
  });

  it("offers three options once maintenance is measured and no target exists", () => {
    const m = buildMaintenance(bootstrap({ targetKcal: null }));
    if (m.status !== "ok") throw new Error("unreachable");
    expect(m.proposal).not.toBeNull();

    const p = m.proposal!;
    expect(p.chips.map((c) => c.key)).toEqual(["cut", "maintain", "bulk"]);
    expect(p.chips.map((c) => c.label)).toEqual(["CUT", "MAINTAIN", "LEAN BULK"]);

    // From proposeTargets(2377, 82.085): ±0.5% bodyweight a week, rounded to 10.
    const [cut, maintain, bulk] = p.chips;
    expect(cut.kcal).toBeLessThan(maintain.kcal);
    expect(bulk.kcal).toBeGreaterThan(maintain.kcal);
    expect(maintain.kcal).toBe(2380);

    // 1.8 g/kg of the fitted bodyweight.
    expect(p.proteinG).toBe(148);

    // The dead end is stated rather than implied: there is no endpoint that
    // writes a targets row.
    expect(p.note).toContain("laptop");
  });

  it("describes each option by what it does to the scale, not just its kcal", () => {
    const m = buildMaintenance(bootstrap({ targetKcal: null }));
    if (m.status !== "ok" || m.proposal === null) throw new Error("unreachable");

    const byKey = Object.fromEntries(m.proposal.chips.map((c) => [c.key, c.detail]));
    expect(byKey.maintain).toMatch(/^2380 kcal · (hold|[+-]0\.0 lb\/wk)$/);
    expect(byKey.cut).toContain("-0.9 lb/wk");
    expect(byKey.bulk).toContain("+0.5 lb/wk");
  });

  it("shows no number at all below the weigh-in floor", () => {
    const m = buildMaintenance(bootstrap({ tdee: insufficient }));
    expect(m.status).toBe("insufficient");
    if (m.status !== "insufficient") throw new Error("unreachable");

    expect(m.note).toContain("5 of 8");
    // Nothing that could be mistaken for an estimate.
    expect(m.note).not.toMatch(/\d{4}/);
  });

  it("says the same thing as the Today screen about an unmeasurable TDEE", () => {
    // The two screens show the same figure; a second wording of the same state
    // reads as two different states.
    const m = buildMaintenance(bootstrap({ tdee: insufficient }));
    if (m.status !== "insufficient") throw new Error("unreachable");
    expect(m.note).toBe(
      "Not enough weigh-ins for a reliable number — 5 of 8. "
      + "Weigh in most mornings and this fills itself in.",
    );
  });
});

describe("buildWeighIn", () => {
  it("shows what was just typed, ahead of the trend", () => {
    const v = buildWeighIn(bootstrap({}), 182.4);
    expect(v.figure).toBe("182.4");
    expect(v.hint).toBe("logged just now");
  });

  it("drops a pointless trailing zero", () => {
    expect(buildWeighIn(bootstrap({}), 180).figure).toBe("180");
  });

  it("shows the fitted trend weight, labelled as such", () => {
    const v = buildWeighIn(bootstrap({}), null);
    // 82.085 kg is 181.0 lb.
    expect(v.figure).toBe("181");
    // Never "last weight": currentKg is a regression output, not a reading.
    expect(v.hint).toBe("trend weight · from 13 weigh-ins");
    expect(v.hint).not.toContain("last");
  });

  it("shows no figure below the floor, and says how far off it is", () => {
    const v = buildWeighIn(bootstrap({ tdee: insufficient }), null);
    expect(v.figure).toBe("—");
    expect(v.hint).toBe("5 weigh-ins so far · 8 needed for a trend");
  });

  it("has a first-run line rather than a count of zero", () => {
    const v = buildWeighIn(
      bootstrap({ tdee: { status: "insufficient_data", weighIns: 0, needed: 8 } }),
      null,
    );
    expect(v.figure).toBe("—");
    expect(v.hint).toBe("No weigh-in on record yet.");
  });

  it("singularises one weigh-in", () => {
    const v = buildWeighIn(
      bootstrap({ tdee: { status: "insufficient_data", weighIns: 1, needed: 8 } }),
      null,
    );
    expect(v.hint).toContain("1 weigh-in so far");
  });
});

describe("weightFromPad", () => {
  it("treats an untouched pad as no entry rather than an error", () => {
    expect(weightFromPad("")).toEqual({ ok: false, reason: null });
    expect(weightFromPad("   ")).toEqual({ ok: false, reason: null });
  });

  it("accepts a plain weight and reports it in lb only", () => {
    const e = weightFromPad("182.4");
    expect(e.ok).toBe(true);
    if (!e.ok) throw new Error("unreachable");
    expect(e.weightLb).toBe(182.4);
    // No kg anywhere on the client: the server converts once, at the edge.
    expect(e).not.toHaveProperty("weightKg");
  });

  it("accepts a trailing decimal point, which the pad can legally emit", () => {
    const e = weightFromPad("182.");
    expect(e.ok).toBe(true);
    if (!e.ok) throw new Error("unreachable");
    expect(e.weightLb).toBe(182);
  });

  it("rounds to a tenth so float noise never reaches the regression", () => {
    const e = weightFromPad("182.44");
    if (!e.ok) throw new Error("unreachable");
    expect(e.weightLb).toBe(182.4);
  });

  it("rejects a doubled keypress", () => {
    const e = weightFromPad("1855");
    expect(e.ok).toBe(false);
    if (e.ok) throw new Error("unreachable");
    expect(e.reason).toContain(`${MIN_WEIGHT_LB} and ${MAX_WEIGHT_LB}`);
  });

  it("rejects a missing keypress", () => {
    expect(weightFromPad("18").ok).toBe(false);
  });

  it("rejects zero", () => {
    const e = weightFromPad("0");
    expect(e.ok).toBe(false);
    if (e.ok) throw new Error("unreachable");
    expect(e.reason).toBe("That is not a weight.");
  });

  it("accepts the bounds themselves", () => {
    expect(weightFromPad(String(MIN_WEIGHT_LB)).ok).toBe(true);
    expect(weightFromPad(String(MAX_WEIGHT_LB)).ok).toBe(true);
  });
});

describe("describeReachability", () => {
  it("leads with the missing URL, which outranks any probe result", () => {
    expect(describeReachability("connected", "")).toEqual({ text: "NO URL SET", tone: "bad" });
  });

  it("maps each probe state to a tone", () => {
    const base = "https://lifemaxx.vercel.app";
    expect(describeReachability("connected", base)).toEqual({ text: "CONNECTED", tone: "good" });
    expect(describeReachability("unreachable", base)).toEqual({ text: "UNREACHABLE", tone: "bad" });
    expect(describeReachability("checking", base).tone).toBe("muted");
    expect(describeReachability("unknown", base).tone).toBe("muted");
  });
});

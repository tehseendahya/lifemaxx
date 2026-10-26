import { describe, expect, it } from "vitest";

import { CATALOGUE, TODAY, bootstrap, day, emptyBootstrap } from "./fixture";
import { goalMeter } from "./goal-meter";
import { goalsBlock } from "./model";
import type { Bootstrap, HistoryDay } from "../../lib/types";

/**
 * One goal as a meter. The direction tests are the ones that matter: a cut and
 * a bulk both have to fill as they progress, and a meter that drains while the
 * owner moves toward their goal is worse than no meter.
 */

const rows = (b: Bootstrap) => goalsBlock(b).targets.map((r) => goalMeter(r, b));

const bench = (points: { date: string; e1rmLb: number }[]) => ({
  exerciseId: "ex-bench", name: "Barbell Bench Press", points,
});

/** Weigh-ins only, TDEE uncalibrated so `currentWeightLb` reads the last one. */
const weighed = (goalsText: string, entries: [string, number][]): Bootstrap => bootstrap({
  goalsText,
  catalogue: CATALOGUE,
  tdee: { status: "insufficient_data", weighIns: entries.length, needed: 8 },
  history: {
    days: entries.map(([date, weightLb]): HistoryDay => day(date, { weightLb })),
    mainLifts: [],
  },
});

describe("lift goals", () => {
  const b = bootstrap({
    goalsText: "205 bench press by 2026-12-27",
    catalogue: CATALOGUE,
    history: { days: [], mainLifts: [bench([{ date: "2026-10-20", e1rmLb: 185.4 }])] },
  });

  it("fills now / target, and labels both ends", () => {
    const [row] = rows(b);
    expect(row.title).toBe("Barbell Bench Press");
    expect(row.meter).toEqual({ fraction: 185 / 205, met: false, nowLabel: "185", targetLabel: "205 lb" });
  });

  it("says how far, and the weekly rate the deadline needs", () => {
    // 2026-10-25 → 2026-12-27 is 9 weeks exactly; 20 lb / 9 = 2.2 lb/wk.
    expect(rows(b)[0].line).toEqual({
      text: "e1RM 185 · 20 lb to go · needs 2.2 lb/wk",
      tone: "ink",
    });
    expect(rows(b)[0].deadline?.label).toBe("9 weeks left");
  });

  it("fills completely and reads good once met", () => {
    const met = bootstrap({
      goalsText: "205 bench press",
      catalogue: CATALOGUE,
      history: { days: [], mainLifts: [bench([{ date: "2026-10-20", e1rmLb: 214 }])] },
    });
    const [row] = rows(met);
    expect(row.meter).toMatchObject({ fraction: 1, met: true });
    expect(row.line).toEqual({ text: "e1RM 214 · goal met", tone: "good" });
  });

  it("draws no meter at all with no data, and says what fills it", () => {
    const none = bootstrap({ goalsText: "205 bench press by December", catalogue: CATALOGUE });
    const [row] = rows(none);
    expect(row.meter).toBeNull();
    expect(row.line).toEqual({
      text: "Log Barbell Bench Press once to start tracking.",
      tone: "muted",
    });
  });

  it("drops the rate line without a deadline", () => {
    const undated = bootstrap({
      goalsText: "205 bench press",
      catalogue: CATALOGUE,
      history: { days: [], mainLifts: [bench([{ date: "2026-10-20", e1rmLb: 185 }])] },
    });
    expect(rows(undated)[0].line.text).toBe("e1RM 185 · 20 lb to go");
  });
});

describe("bodyweight goals", () => {
  it("fills a cut as weight comes down from the first weigh-in", () => {
    // Started 190, now 185, target 180: halfway.
    const b = weighed("Cut to 180 lb", [["2026-09-10", 190], ["2026-10-24", 185]]);
    const [row] = rows(b);
    expect(row.title).toBe("Bodyweight");
    expect(row.meter).toEqual({ fraction: 0.5, met: false, nowLabel: "185", targetLabel: "180 lb" });
    expect(row.since).toBe("since 10 Sep");
    expect(row.line).toEqual({ text: "185 now · 5 lb to go", tone: "ink" });
  });

  it("fills a bulk as weight goes up — the same formula, the other sign", () => {
    // Started 170, now 175, target 180: halfway, not −50%.
    const b = weighed("Bulk up to 180 lb", [["2026-09-10", 170], ["2026-10-24", 175]]);
    expect(rows(b)[0].meter).toMatchObject({ fraction: 0.5, met: false });
  });

  it("clamps at empty when a cut has gone the wrong way", () => {
    const b = weighed("Cut to 180 lb", [["2026-09-10", 190], ["2026-10-24", 193]]);
    expect(rows(b)[0].meter).toMatchObject({ fraction: 0, met: false });
  });

  it("calls an overshot cut met, and a bulk that overshoots too", () => {
    const cut = weighed("Cut to 180 lb", [["2026-09-10", 190], ["2026-10-24", 178]]);
    expect(rows(cut)[0].meter).toMatchObject({ fraction: 1, met: true });
    expect(rows(cut)[0].line).toEqual({ text: "178 now · goal met", tone: "good" });

    const bulk = weighed("Bulk up to 180 lb", [["2026-09-10", 170], ["2026-10-24", 182]]);
    expect(rows(bulk)[0].meter).toMatchObject({ fraction: 1, met: true });
  });

  it("signs the weekly rate a deadline needs in the goal's direction", () => {
    // 2026-10-25 → 2026-12-27 is 9 weeks; −5 lb / 9 = −0.6 lb/wk.
    const cut = weighed("Cut to 180 lb by 2026-12-27", [["2026-09-10", 190], ["2026-10-24", 185]]);
    expect(rows(cut)[0].line.text).toBe("185 now · 5 lb to go · needs −0.6 lb/wk");

    const bulk = weighed("Bulk up to 180 lb by 2026-12-27", [["2026-09-10", 170], ["2026-10-24", 175]]);
    expect(rows(bulk)[0].line.text).toBe("175 now · 5 lb to go · needs +0.6 lb/wk");
  });

  it("draws no meter before the first weigh-in", () => {
    const b = emptyBootstrap({ goalsText: "Cut to 180 lb", catalogue: CATALOGUE });
    const [row] = rows(b);
    expect(row.meter).toBeNull();
    expect(row.line).toEqual({ text: "Weigh in to start tracking.", tone: "muted" });
  });
});

describe("run and rep goals", () => {
  it("get no meter, only the existing gap line", () => {
    const b = bootstrap({ goalsText: "Run a half marathon in 1:50", catalogue: CATALOGUE });
    const [row] = rows(b);
    expect(row.meter).toBeNull();
    expect(row.title).toBe("13.1 mi in 1:50");
    expect(row.line).toEqual({ text: "not enough data", tone: "muted" });
  });
});

describe("provenance", () => {
  it("keeps the owner's sentence for You to print", () => {
    const b = bootstrap({ goalsText: "205 bench press by December", catalogue: CATALOGUE, today: TODAY });
    expect(rows(b)[0].sentence).toBe("205 bench press by December");
  });
});

import { describe, expect, it } from "vitest";

import { TODAY, bootstrap, day, ranked } from "./fixture";
import { GRID_WEEKS, VOLUME_ROWS_MAX, liftDayGrid, volumeBlock } from "./volume";
import type { RankedMuscle } from "../../lib/types";

/**
 * There is no simulator in this container, so every figure this card prints is
 * asserted here or it has never been seen by anybody.
 *
 * The cases that matter most are the owner's actual ones: one logged session,
 * fifteen muscles never trained at all, and the same session once it falls out
 * of the 7-day window. Those are not edge cases for this account — they are the
 * state it is in right now, which is exactly why the card it replaced was
 * unreadable.
 */

/** The owner's real state: bench 4 working sets + incline smith 3, nothing else. */
function ownersRanked(): RankedMuscle[] {
  const trained: RankedMuscle[] = [
    ranked({ muscle: "chest", label: "Chest", setsLast7d: 7, daysSinceTrained: 4, score: 0.6 }),
    ranked({
      muscle: "front_delt", label: "Front Delts", setsLast7d: 3.5,
      daysSinceTrained: 4, score: 0.8,
    }),
    ranked({
      muscle: "tricep", label: "Triceps", setsLast7d: 3.5,
      daysSinceTrained: 4, score: 0.8,
    }),
  ];

  /*
   * Fifteen muscles with `daysSinceTrained: null` — the never-logged ones. They
   * all score 1.0 (`debt 1 × recovery 1`), which is why they sit at the top of
   * `ranked` and why this card must not name them: they are a coverage gap, not
   * a debt, and the Lift tab's NEXT UP card is the single place that names and
   * ranks them.
   */
  const never = [
    "side_delt", "rear_delt", "lat", "upper_back", "trap", "bicep", "forearm",
    "quad", "hamstring", "glute", "calf", "abs", "lower_back", "adductor", "abductor",
  ].map((muscle) => ranked({
    muscle, label: muscle, setsLast7d: 0, daysSinceTrained: null, score: 1,
  }));

  return [...never, ...trained];
}

const many = (n: number, sets: (i: number) => number): RankedMuscle[] =>
  Array.from({ length: n }, (_, i) => ranked({
    muscle: `m${i}`,
    label: `M${i}`,
    setsLast7d: sets(i),
    daysSinceTrained: 2,
    score: 0.5,
  }));

describe("rows", () => {
  it("ranks trained muscles by sets, one decimal, status from the shared band", () => {
    const v = volumeBlock(bootstrap());

    expect(v.rows.map((r) => [r.label, r.value, r.status])).toEqual([
      ["Quads", "12.0", "in_range"],
      ["Chest", "8.0", "under"],
      ["Lats", "1.5", "under"],
      // Zero sets but real history and real debt: appended after every trained
      // muscle rather than ranked in among them.
      ["Rear Delts", "0.0", "under"],
    ]);
    expect(v.min).toBe(10);
    expect(v.max).toBe(20);
    expect(v.footer).toBeNull();
    expect(v.note).toBeNull();
  });

  it("never names a muscle that has nothing logged at all", () => {
    const v = volumeBlock(bootstrap({
      volume: { summary: "", ranked: ownersRanked() },
      history: { days: [day("2026-10-21", { hardSets: 7 })], mainLifts: [] },
    }));

    expect(v.rows.map((r) => [r.label, r.value])).toEqual([
      ["Chest", "7.0"],
      ["Front Delts", "3.5"],
      ["Triceps", "3.5"],
    ]);
    // The fifteen never-logged muscles contribute their count and nothing else.
    expect(v.footer).toBe("15 more muscles: nothing in the last 7 days.");
    expect(v.rows.every((r) => r.status === "under")).toBe(true);
  });

  it("caps the list and never drops a trained muscle silently", () => {
    const v = volumeBlock(bootstrap({
      volume: { summary: "", ranked: many(10, (i) => 10 - i) },
    }));

    expect(v.rows).toHaveLength(VOLUME_ROWS_MAX);
    expect(v.rows[0].value).toBe("10.0");
    expect(v.footer).toBe("2 more muscles trained this week, below these.");
  });

  it("separates the two reasons a muscle is missing when both apply", () => {
    const v = volumeBlock(bootstrap({
      volume: {
        summary: "",
        ranked: [
          ...many(9, () => 6),
          ranked({ muscle: "z", label: "Z", setsLast7d: 0, daysSinceTrained: null, score: 1 }),
        ],
      },
    }));

    expect(v.rows).toHaveLength(VOLUME_ROWS_MAX);
    expect(v.footer).toBe("2 more muscles, 1 with nothing in the last 7 days.");
  });
});

describe("the domain", () => {
  it("is the band's top until a row exceeds it, then self-scales", () => {
    expect(volumeBlock(bootstrap()).domainMax).toBe(20);

    const over = volumeBlock(bootstrap({
      volume: { summary: "", ranked: [ranked({ muscle: "chest", label: "Chest", setsLast7d: 25, daysSinceTrained: 1, score: 0 })] },
    }));
    expect(over.domainMax).toBe(25);
    expect(over.rows[0].status).toBe("over");
  });

  it("labels the axis once, at zero and at both band edges", () => {
    expect(volumeBlock(bootstrap()).ticks).toEqual([
      { label: "0", fraction: 0 },
      { label: "10", fraction: 0.5 },
      { label: "20", fraction: 1 },
    ]);
  });

  it("names the band in one line, always on screen", () => {
    expect(volumeBlock(bootstrap()).explainer)
      .toBe("Weekly working sets per muscle against the 10–20 productive range.");
  });

  it("keeps the weighting one tap away rather than gone", () => {
    // The literal answer to "what's the y axis". Moved behind a toggle, never
    // deleted: the figure is a weighted sum and nothing on the row says so.
    const v = volumeBlock(bootstrap());
    expect(v.howCounted).toContain("1 chest, ½ front delt, ½ tricep");
    expect(v.howCounted).toContain("The band is 10–20 sets a week, the productive range.");
  });
});

describe("the empty states", () => {
  it("says what appears once there is data, and offers one action", () => {
    const v = volumeBlock(bootstrap({
      volume: { summary: "", ranked: ownersRanked().map((r) => ({ ...r, setsLast7d: 0 })) },
      history: { days: [], mainLifts: [] },
    }));

    expect(v.rows).toEqual([]);
    expect(v.note).toBe(
      "Nothing logged yet. Log a session and every muscle you trained appears here "
      + "against the 10–20 set range.",
    );
    expect(v.navLabel).toBe("Start a lift →");
    expect(v.footer).toBeNull();
  });

  it("names the last session rather than claiming there is no data", () => {
    /*
     * The owner's state whenever their one logged session is more than a week
     * old. The per-muscle panel genuinely has nothing, and the lift-day grid in
     * "This month" is the one panel that does — so this must not read as "you
     * have no data".
     */
    const v = volumeBlock(bootstrap({
      volume: { summary: "", ranked: ownersRanked().map((r) => ({ ...r, setsLast7d: 0 })) },
      history: { days: [day("2026-10-02", { hardSets: 7 })], mainLifts: [] },
    }));

    expect(v.rows).toEqual([]);
    expect(v.note).toBe("Nothing in the last 7 days. Your last session was 2 Oct.");
    expect(v.navLabel).toBe("What to train next →");
  });

  it("draws no zero rows, ever", () => {
    const v = volumeBlock(bootstrap({
      volume: {
        summary: "",
        // Owed, with history, and nothing this week. Still not a row of its own
        // when the whole window is empty.
        ranked: [ranked({ setsLast7d: 0, daysSinceTrained: 9, score: 1 })],
      },
      history: { days: [], mainLifts: [] },
    }));
    expect(v.rows).toEqual([]);
  });
});

describe("the lift-day grid (drawn by This month)", () => {
  it("is eight Monday-start weeks of seven cells, oldest first", () => {
    const grid = liftDayGrid(bootstrap({
      history: { days: [day("2026-09-03", { hardSets: 12 })], mainLifts: [] },
    }));

    expect(grid.weeks).toHaveLength(GRID_WEEKS);
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
    expect(grid.weekdays).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
    // TODAY is a Sunday, so its ISO week starts 2026-10-19 and eight weeks back
    // is 2026-08-31 — exactly the first day `history.days` covers.
    expect(grid.weeks[0][0].date).toBe("2026-08-31");
    expect(grid.weeks[7][0].date).toBe("2026-10-19");
    expect(grid.weeks[7][6].date).toBe(TODAY);
  });

  it("fills a day with a working set, greys a day without, draws nothing ahead", () => {
    const grid = liftDayGrid(bootstrap({
      today: "2026-10-21", // a Wednesday, so the current week has future cells
      history: {
        days: [day("2026-10-20", { hardSets: 9 }), day("2026-10-19", { hardSets: 0 })],
        mainLifts: [],
      },
    }));
    const week = grid.weeks[7];

    expect(week.map((c) => c.state)).toEqual([
      "past", // Mon 19th — logged, but zero working sets
      "lifted", // Tue 20th
      "past", // Wed 21st, today
      "future", "future", "future", "future",
    ]);
  });

  it("counts lift days and does not print \"1 days\"", () => {
    const one = liftDayGrid(bootstrap({
      history: { days: [day("2026-10-21", { hardSets: 7 })], mainLifts: [] },
    }));
    expect(one.days).toBe(1);
    expect(one.rightLabel).toBe("1 day");

    // The fixture's default history is eight lift days inside the window.
    const several = liftDayGrid(bootstrap());
    expect(several.days).toBe(8);
    expect(several.rightLabel).toBe("8 days");
  });

  it("ignores lift days older than the eight-week window", () => {
    const grid = liftDayGrid(bootstrap({
      history: { days: [day("2026-08-24", { hardSets: 20 })], mainLifts: [] },
    }));
    expect(grid.days).toBe(0);
  });
});

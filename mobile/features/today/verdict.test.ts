import { describe, expect, it } from "vitest";

import { bootstrap, day, liftHistory, ranked, run, TODAY } from "./fixture";
import { EMPTY_VERDICT, verdict } from "./verdict";
import { agrees, refersTo } from "./model";

/**
 * One test per rung of the ladder, plus the voice rules over every branch.
 *
 * The voice assertions are the ones worth having. A wrong number on this screen
 * is a bug; a hedged sentence is the app failing at the only job it has, which
 * is to answer "what do I do in the next hour" without making the owner decide
 * for it.
 */

const owedLowerBody = [
  ranked({ muscle: "quad", label: "Quads", score: 1, daysSinceTrained: 9 }),
  ranked({ muscle: "hamstring", label: "Hamstrings", score: 0.8, daysSinceTrained: 9 }),
];

describe("rung 1 — nothing logged", () => {
  it("names what is missing and what appears once it is there", () => {
    const b = bootstrap({ history: { days: [], mainLifts: [] } });
    expect(verdict(b)).toEqual({
      text: "No sessions in the last four weeks. Start one. Every lift you log ranks your "
        + "muscles by the sets they're owed, and this line picks today's for you.",
      tone: "ink",
      kind: "empty",
    });
    expect(verdict(b).text).toBe(EMPTY_VERDICT);
  });

  it("treats a day with only warmups as no session", () => {
    // `liftDaysIn` counts days with working sets; hardSets 0 is not a lift day.
    const b = bootstrap({ history: { days: [day("2026-10-24")], mainLifts: [] } });
    expect(verdict(b).text).toBe(EMPTY_VERDICT);
  });

  it("counts only days inside the 28-day window", () => {
    // Seven lift days, every one of them older than four weeks.
    const stale = ["2026-08-01", "2026-08-03", "2026-08-05", "2026-08-07",
      "2026-08-09", "2026-08-11", "2026-08-13"].map((d) => day(d, { hardSets: 18 }));
    const b = bootstrap({ history: { days: stale, mainLifts: [] } });
    expect(verdict(b).text).toBe(EMPTY_VERDICT);
  });

  it("outranks an active session and an interference hit", () => {
    const b = bootstrap({
      history: { days: [], mainLifts: [] },
      activeWorkout: { id: "w1", startedAt: "2026-10-25T16:00:00.000Z" },
      runs: [run({ sufferScore: 95 })],
      lowerBodyLiftDates: ["2026-10-24"],
    });
    expect(verdict(b).text).toBe(EMPTY_VERDICT);
  });

  /*
   * The regression that motivated dropping this floor from five days to one.
   * The owner had logged exactly one session and every surface on Today read as
   * an apology. Volume debt is a count, not a trend, so one day is enough to
   * rank from — and the rung above must not swallow it.
   */
  it("hands one logged day straight to the volume-debt rung", () => {
    const b = bootstrap({
      history: { days: [day("2026-10-24", { hardSets: 9 })], mainLifts: [] },
    });
    expect(verdict(b).text).toBe(
      "Rear Delts are 10 sets short this week and you last hit them 9 days ago. "
      + "Train Rear Delts.",
    );
  });

  it("lets four logged days reach interference, which used to be unreachable", () => {
    const b = bootstrap({
      history: { days: liftHistory().slice(0, 4), mainLifts: [] },
      runs: [run({ sufferScore: 95 })],
      lowerBodyLiftDates: ["2026-10-24"],
    });
    expect(verdict(b).tone).toBe("warn");
    expect(verdict(b).text).toContain("You ran hard yesterday.");
  });
});

describe("rung 2 — interference", () => {
  it("names the trade and hands over a recovered non-leg muscle", () => {
    const b = bootstrap({
      runs: [run({ sufferScore: 95 })],
      lowerBodyLiftDates: ["2026-10-24"],
    });
    expect(verdict(b)).toEqual({
      text: "You ran hard yesterday. Legs on top of that is the trade — "
        + "do Rear Delts instead and squat Friday.",
      tone: "warn",
      kind: "interference",
    });
  });

  it("says long rather than hard for a long run", () => {
    const b = bootstrap({
      // 9 miles clears LONG_RUN_MI, which classifies as long regardless of pace.
      runs: [run({ localDate: TODAY, distanceM: 14_484, durationS: 5400, sufferScore: 10 })],
      lowerBodyLiftDates: [TODAY],
    });
    expect(verdict(b).text).toContain("You ran long today.");
  });

  it("falls back to easing off when everything behind is lower body", () => {
    const b = bootstrap({
      volume: { summary: "", ranked: owedLowerBody },
      runs: [run({ sufferScore: 95 })],
      lowerBodyLiftDates: ["2026-10-24"],
    });
    expect(verdict(b).text).toBe(
      "You ran hard yesterday. Legs on top of that is the trade — "
      + "take the lower body work easy today; nothing else is behind.",
    );
  });

  it("ignores a collision older than yesterday", () => {
    const b = bootstrap({
      runs: [run({ localDate: "2026-10-18", sufferScore: 95 })],
      lowerBodyLiftDates: ["2026-10-18"],
    });
    expect(verdict(b).tone).toBe("ink");
    expect(verdict(b).text).not.toContain("You ran");
  });

  it("ignores an easy run on a leg day — that is the plan working", () => {
    const b = bootstrap({
      runs: [run({ sufferScore: 10, distanceM: 4800, durationS: 1800 })],
      lowerBodyLiftDates: ["2026-10-24"],
    });
    expect(verdict(b).text).not.toContain("You ran");
  });

  it("does not look for interference when there are no runs at all", () => {
    expect(verdict(bootstrap({ lowerBodyLiftDates: ["2026-10-24"] })).text)
      .not.toContain("You ran");
  });
});

describe("rung 3 — mid-session", () => {
  const active = { id: "w1", startedAt: "2026-10-25T16:00:00.000Z" };

  it("names what is still short", () => {
    const b = bootstrap({ activeWorkout: active });
    expect(verdict(b)).toEqual({
      text: "You're mid-session. Rear Delts are still 10 sets short this week.",
      tone: "ink",
      kind: "session",
    });
  });

  it("says to finish on feel when nothing is owed", () => {
    const b = bootstrap({
      activeWorkout: active,
      volume: { summary: "", ranked: [ranked({ setsLast7d: 14, score: 0 })] },
    });
    expect(verdict(b).text).toBe("You're mid-session. Nothing's behind — finish on feel.");
  });
});

describe("rung 4 — owed and recovered", () => {
  it("names the muscle, the debt, the recency and the instruction", () => {
    expect(verdict(bootstrap())).toEqual({
      text: "Rear Delts are 10 sets short this week and you last hit them 9 days ago. "
        + "Train Rear Delts.",
      tone: "ink",
      kind: "owed",
    });
  });

  it("says never logged rather than printing a day count of null", () => {
    const b = bootstrap({
      volume: { summary: "", ranked: [ranked({ muscle: "trap", label: "Traps", daysSinceTrained: null })] },
    });
    expect(verdict(b).text).toBe(
      "Traps are 10 sets short this week and you've never logged them. Train Traps.",
    );
  });

  it("never claims a muscle is 0 sets short", () => {
    // 9.6 of 10 sets rounds to a debt of 0, which would read as a contradiction.
    const b = bootstrap({
      volume: { summary: "", ranked: [ranked({ setsLast7d: 9.6, score: 0.21 })] },
    });
    expect(verdict(b).text).toContain("1 set short");
  });
});

describe("rung 5 — owed but not recovered", () => {
  it("hands over the best recovered alternative", () => {
    const b = bootstrap({
      volume: {
        summary: "",
        ranked: [
          ranked({ muscle: "chest", label: "Chest", score: 1, daysSinceTrained: 1 }),
          ranked({ muscle: "lat", label: "Lats", score: 0.7, daysSinceTrained: 4 }),
        ],
      },
    });
    expect(verdict(b).text).toBe("Chest is short but you trained it yesterday. Do Lats instead.");
    expect(verdict(b).kind).toBe("alternative");
  });

  it("says today when the collision is the same day", () => {
    const b = bootstrap({
      volume: {
        summary: "",
        ranked: [
          ranked({ muscle: "chest", label: "Chest", score: 1, daysSinceTrained: 0 }),
          ranked({ muscle: "lat", label: "Lats", score: 0.7, daysSinceTrained: 4 }),
        ],
      },
    });
    expect(verdict(b).text).toContain("you trained it today");
  });

  it("offers the day off when every owed muscle is still inside 48 hours", () => {
    const b = bootstrap({
      volume: {
        summary: "",
        ranked: [
          ranked({ muscle: "chest", label: "Chest", score: 1, daysSinceTrained: 1 }),
          ranked({ muscle: "quad", label: "Quads", score: 0.9, daysSinceTrained: 0 }),
          // In range, so not an alternative however well recovered it is.
          ranked({ muscle: "calf", label: "Calves", score: 0.05, setsLast7d: 14, daysSinceTrained: 6 }),
        ],
      },
    });
    expect(verdict(b).text).toBe(
      "Everything that's behind, you trained in the last 48 hours. Take today off.",
    );
    // The hero card reads this to swap START LIFT for a secondary button.
    expect(verdict(b).kind).toBe("rest");
  });
});

describe("rung 6 — nothing owed", () => {
  it("offers the hardest honest session or the day", () => {
    const b = bootstrap({
      volume: { summary: "", ranked: [ranked({ setsLast7d: 16, score: 0.1 })] },
    });
    expect(verdict(b)).toEqual({
      text: "Nothing's behind this week. Hardest honest session you feel like, or take the day.",
      tone: "ink",
      kind: "nothing_owed",
    });
  });

  it("does not crash on an empty ranking", () => {
    const b = bootstrap({ volume: { summary: "", ranked: [] } });
    expect(verdict(b).text).toContain("Nothing's behind this week.");
  });
});

describe("voice", () => {
  /** Every branch of the ladder, so the assertions below cover all of them. */
  const everyBranch = (): string[] => [
    verdict(bootstrap({ history: { days: [], mainLifts: [] } })).text,
    verdict(bootstrap({ runs: [run({ sufferScore: 95 })], lowerBodyLiftDates: ["2026-10-24"] })).text,
    verdict(bootstrap({
      volume: { summary: "", ranked: owedLowerBody },
      runs: [run({ sufferScore: 95 })],
      lowerBodyLiftDates: ["2026-10-24"],
    })).text,
    verdict(bootstrap({ activeWorkout: { id: "w1", startedAt: "2026-10-25T16:00:00.000Z" } })).text,
    verdict(bootstrap({
      activeWorkout: { id: "w1", startedAt: "2026-10-25T16:00:00.000Z" },
      volume: { summary: "", ranked: [] },
    })).text,
    verdict(bootstrap()).text,
    verdict(bootstrap({
      volume: { summary: "", ranked: [ranked({ daysSinceTrained: null })] },
    })).text,
    verdict(bootstrap({
      volume: {
        summary: "",
        ranked: [
          ranked({ muscle: "chest", label: "Chest", score: 1, daysSinceTrained: 1 }),
          ranked({ muscle: "lat", label: "Lats", score: 0.7, daysSinceTrained: 4 }),
        ],
      },
    })).text,
    verdict(bootstrap({
      volume: { summary: "", ranked: [ranked({ muscle: "chest", label: "Chest", score: 1, daysSinceTrained: 1 })] },
    })).text,
    verdict(bootstrap({ volume: { summary: "", ranked: [] } })).text,
  ];

  it("covers every rung", () => {
    // Ten branches, ten distinct sentences. If two of these ever collide, one
    // rung has become unreachable and the ladder has a dead branch in it.
    expect(new Set(everyBranch()).size).toBe(10);
  });

  it("never hedges", () => {
    const hedges = [
      "maybe", "consider", "you might", "could be worth", "perhaps",
      "try to", "ideally", "probably", "if you want",
    ];
    for (const text of everyBranch()) {
      for (const hedge of hedges) {
        expect(text.toLowerCase()).not.toContain(hedge);
      }
    }
  });

  it("never praises and never exclaims", () => {
    const praise = ["great", "nice", "well done", "crushing", "awesome", "keep it up", "proud"];
    for (const text of everyBranch()) {
      expect(text).not.toContain("!");
      for (const word of praise) expect(text.toLowerCase()).not.toContain(word);
    }
  });

  it("is at most two sentences, and the instruction is always one of them", () => {
    // Rung 1 is the single exception and is asserted on its own below.
    for (const text of everyBranch().filter((t) => t !== EMPTY_VERDICT)) {
      const sentences = text.split(/(?<=\.)\s+/).filter(Boolean);
      expect(sentences.length).toBeLessThanOrEqual(2);
      expect(text.endsWith(".")).toBe(true);
    }
  });

  it("lets only the empty rung run to three sentences: admission, instruction, why", () => {
    const sentences = EMPTY_VERDICT.split(/(?<=\.)\s+/).filter(Boolean);
    expect(sentences).toHaveLength(3);
    expect(sentences[1]).toBe("Start one.");
  });
});

// ------------------------------------------------------- subject agreement

describe("it agrees with the muscle it names", () => {
  /*
   * 15 of the 18 muscle labels are plural, so a hard-coded "is" read wrong far
   * more often than right — "Rear Delts is 10 sets short" was on the screen.
   * Verb and pronoun both have to follow the label.
   */
  const owed = (muscle: string, label: string) => bootstrap({
    volume: {
      summary: "",
      ranked: [ranked({ muscle: muscle as never, label, score: 1, daysSinceTrained: 9 })],
    },
  });

  it("says 'are' and 'them' for a plural label", () => {
    const text = verdict(owed("rear_delt", "Rear Delts")).text;
    expect(text).toContain("Rear Delts are");
    expect(text).not.toContain("Rear Delts is");
    expect(text).toMatch(/hit them|logged them/);
  });

  it("says 'is' and 'it' for a singular label", () => {
    const text = verdict(owed("chest", "Chest")).text;
    expect(text).toContain("Chest is");
    expect(text).not.toContain("Chest are");
    expect(text).toMatch(/hit it|logged it/);
  });

  it("agrees for every label the domain can produce", () => {
    const plurals = ["Front Delts", "Side Delts", "Rear Delts", "Lats", "Traps", "Biceps",
      "Triceps", "Forearms", "Quads", "Hamstrings", "Glutes", "Calves", "Abs",
      "Adductors", "Abductors"];
    const singulars = ["Chest", "Upper Back", "Lower Back"];

    for (const label of plurals) {
      expect(agrees(label), label).toBe("are");
      expect(refersTo(label), label).toBe("them");
    }
    for (const label of singulars) {
      expect(agrees(label), label).toBe("is");
      expect(refersTo(label), label).toBe("it");
    }
  });
});

import { describe, expect, it } from "vitest";

import type {
  Bootstrap, CatalogueExercise, HistoryDay, LastSet, MuscleContributionDto, RankedMuscle,
  RecentWorkoutDto,
} from "../../lib/types";
import {
  GAP_NAMED_LIMIT, NEXT_UP_LIMIT, THIN_LIFT_DAYS,
  deleteWorkoutPrompt, lastSessionBlock, mainLiftRows, nextUpBlock, recentWorkoutRows,
} from "./next";

/**
 * There is no simulator in this container, so every string the Lift page prints
 * when a session is not running is asserted here or nobody has ever seen it.
 *
 * The state that matters most is the owner's real one: ONE logged session, one
 * weigh-in, fifteen muscles with nothing against them at all. That is not an
 * edge case — it is what the screen looks like for the whole of a new account's
 * first fortnight, and it is the state the card this replaces got wrong.
 *
 * A fixture local to this file rather than `../today/fixture`: that module's
 * `CATALOGUE` rows carry `muscles: []`, and the two tier-2 orderings and the
 * derived session name all read `catalogue[].muscles`. A fixture whose central
 * field is empty would make three of these assertions vacuous.
 */

const TODAY = "2026-10-25";

const m = (muscle: string, contribution: number): MuscleContributionDto =>
  ({ muscle, contribution });

/** Bench and incline both: 1 chest, ½ front delt, ½ tricep. The owner's two lifts. */
const PRESS = [m("chest", 1), m("front_delt", 0.5), m("tricep", 0.5)];

function cat(id: string, name: string, muscles: MuscleContributionDto[]): CatalogueExercise {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    incrementLb: 5,
    equipment: "barbell",
    muscles,
  };
}

/**
 * Seven rows, chosen so the tier-2 trainability count is not a tie: biceps are
 * trained by three of them, abs/abductors/forearms by one each, and lats by
 * none. That ordering is the whole reason tier 2 does not lead with Abductors.
 */
const CATALOGUE: CatalogueExercise[] = [
  cat("ex-bench", "Barbell Bench Press", PRESS),
  cat("ex-smith", "Smith Machine Incline Press", PRESS),
  cat("ex-curl", "Dumbbell Curl", [m("bicep", 1)]),
  cat("ex-hammer", "Hammer Curl", [m("bicep", 1), m("forearm", 0.5)]),
  cat("ex-preacher", "Preacher Curl", [m("bicep", 1)]),
  cat("ex-crunch", "Cable Crunch", [m("abs", 1)]),
  cat("ex-abduction", "Hip Abduction", [m("abductor", 1), m("glute", 0.25)]),
];

function rank(
  muscle: string,
  label: string,
  setsLast7d: number,
  daysSinceTrained: number | null,
  score: number,
): RankedMuscle {
  return { muscle, label, setsLast7d, daysSinceTrained, score };
}

/** The five muscles the fixture catalogue can reach that the owner has never trained. */
const NEVER: RankedMuscle[] = [
  rank("bicep", "Biceps", 0, null, 1),
  rank("abs", "Abs", 0, null, 1),
  rank("abductor", "Abductors", 0, null, 1),
  rank("forearm", "Forearms", 0, null, 1),
  rank("lat", "Lats", 0, null, 1),
];

/**
 * The owner's one session, four days ago: bench 165×5 for four sets at RPE 7,
 * smith incline 155×8 for three. Chest lands on 7.0 weighted sets, front delts
 * and triceps on 3.5 each.
 */
const TRAINED: RankedMuscle[] = [
  rank("front_delt", "Front Delts", 3.5, 4, 0.65),
  rank("tricep", "Triceps", 3.5, 4, 0.65),
  rank("chest", "Chest", 7, 4, 0.3),
];

const LAST_SETS: Record<string, LastSet> = {
  "ex-bench": {
    localDate: "2026-10-21", weightLb: 165, reps: 5, rpe: 7, sets: 4, bestE1rmLb: 193,
  },
  "ex-smith": {
    localDate: "2026-10-21", weightLb: 155, reps: 8, rpe: null, sets: 3, bestE1rmLb: 193,
  },
};

const day = (date: string, hardSets = 7): HistoryDay =>
  ({ date, weightLb: null, kcal: null, hardSets });

function bootstrap(over: Partial<Bootstrap> = {}): Bootstrap {
  return {
    today: TODAY,
    tz: "America/New_York",
    goalsText: "",
    target: { kcal: null, proteinG: 165, carbsG: null, fatG: null, mode: "calibrating" },
    totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    mealCount: 0,
    volume: { summary: "", ranked: [...NEVER, ...TRAINED] },
    tdee: { status: "insufficient_data", weighIns: 1, needed: 8 },
    activeWorkout: null,
    runs: [],
    lowerBodyLiftDates: [],
    gyms: [],
    catalogue: CATALOGUE,
    lastSets: LAST_SETS,
    history: { days: [day("2026-10-21")], mainLifts: [] },
    ...over,
  };
}

// --------------------------------------------------------------------- tier 1

describe("nextUpBlock — what to train", () => {
  it("names the two worst muscles with a figure, a unit and a reason", () => {
    const next = nextUpBlock(bootstrap());

    expect(next.rows).toHaveLength(2);
    expect(next.rows[0]).toEqual({
      muscle: "front_delt",
      label: "Front Delts",
      detail: "3.5 of 10 sets · last hit 4d ago",
    });
    expect(next.rows[1].detail).toBe("3.5 of 10 sets · last hit 4d ago");
    expect(next.note).toBeNull();
  });

  it("caps tier 1 at two rows even when five muscles are owed", () => {
    const owed = [
      rank("chest", "Chest", 1, 6, 0.9),
      rank("lat", "Lats", 2, 5, 0.8),
      rank("quad", "Quads", 3, 4, 0.7),
      rank("bicep", "Biceps", 4, 3, 0.6),
      rank("tricep", "Triceps", 5, 2, 0.5),
    ];
    const next = nextUpBlock(bootstrap({ volume: { summary: "", ranked: owed } }));

    expect(next.rows).toHaveLength(NEXT_UP_LIMIT);
    expect(next.rows.map((r) => r.label)).toEqual(["Chest", "Lats"]);
  });

  it("keeps the server's order rather than re-ranking on device", () => {
    // Deliberately out of score order: the server's array order is the one the
    // laptop uses, and two rankings for one muscle on one day is the bug.
    const scrambled = [
      rank("tricep", "Triceps", 2, 3, 0.4),
      rank("chest", "Chest", 1, 6, 0.9),
    ];
    const next = nextUpBlock(bootstrap({ volume: { summary: "", ranked: scrambled } }));

    expect(next.rows.map((r) => r.label)).toEqual(["Triceps", "Chest"]);
  });

  it("never puts a muscle with nothing logged in tier 1", () => {
    const next = nextUpBlock(bootstrap());
    // All five NEVER rows score 1.0 and sort ahead of everything real.
    expect(next.rows.map((r) => r.muscle)).not.toContain("bicep");
  });

  it("drops a muscle below the owed threshold", () => {
    const next = nextUpBlock(bootstrap({
      volume: { summary: "", ranked: [rank("quad", "Quads", 19, 1, 0.2)] },
    }));
    expect(next.rows).toHaveLength(0);
  });

  it("says yesterday rather than 1d ago", () => {
    const next = nextUpBlock(bootstrap({
      volume: { summary: "", ranked: [rank("chest", "Chest", 4, 1, 0.5)] },
    }));
    expect(next.rows[0].detail).toBe("4.0 of 10 sets · last hit yesterday");
  });

  it("prints one decimal on a whole number so the figures line up", () => {
    const next = nextUpBlock(bootstrap({
      volume: { summary: "", ranked: [rank("chest", "Chest", 7, 3, 0.5)] },
    }));
    expect(next.rows[0].detail).toBe("7.0 of 10 sets · last hit 3d ago");
  });
});

// --------------------------------------------------------------------- tier 2

describe("nextUpBlock — the coverage gap", () => {
  it("orders never-logged muscles by how many lifts can train them", () => {
    const next = nextUpBlock(bootstrap());
    // Biceps (3 exercises) first; then the three one-exercise muscles by label
    // — "Abductors" sorts before "Abs" — and Lats, which nothing in this
    // catalogue trains at all, last.
    expect(next.gap).toBe(
      "5 muscles have nothing logged yet — Biceps, Abductors, Abs and 2 more.",
    );
  });

  it("names them all without a count when there are no more than three", () => {
    const ranked = [...TRAINED, NEVER[0], NEVER[1], NEVER[2]];
    const next = nextUpBlock(bootstrap({ volume: { summary: "", ranked } }));

    expect(next.gap).toBe("3 muscles have nothing logged yet — Biceps, Abductors, Abs.");
    expect(GAP_NAMED_LIMIT).toBe(3);
  });

  it("agrees with a single muscle", () => {
    const next = nextUpBlock(bootstrap({
      volume: { summary: "", ranked: [...TRAINED, NEVER[1]] },
    }));
    expect(next.gap).toBe("1 muscle has nothing logged yet — Abs.");
  });

  it("has no gap line once everything has been trained at least once", () => {
    const next = nextUpBlock(bootstrap({ volume: { summary: "", ranked: TRAINED } }));
    expect(next.gap).toBeNull();
  });
});

// ------------------------------------------------------------- the empty cases

describe("nextUpBlock — never a blank card, never a refusal", () => {
  it("states the recovery case instead of ranking what cannot be trained", () => {
    // The owner's state on the evening of a session: everything short, trained
    // hours ago, so the server's recovery gate has zeroed every score.
    const justTrained = [
      rank("chest", "Chest", 7, 0, 0),
      rank("front_delt", "Front Delts", 3.5, 0, 0),
    ];
    const next = nextUpBlock(bootstrap({ volume: { summary: "", ranked: justTrained } }));

    expect(next.rows).toHaveLength(0);
    expect(next.note).toBe(
      "Everything you're short on was trained in the last two days. Train what you like, or rest.",
    );
  });

  it("says nothing is short when nothing is short", () => {
    const inRange = [
      rank("chest", "Chest", 14, 1, 0),
      rank("lat", "Lats", 12, 2, 0),
    ];
    const next = nextUpBlock(bootstrap({ volume: { summary: "", ranked: inRange } }));

    expect(next.note).toBe(
      "Nothing you've trained is short on sets this week. Train what you like, or rest.",
    );
  });

  it("gives a first-day account one sentence rather than eighteen deficiencies", () => {
    const next = nextUpBlock(bootstrap({
      volume: { summary: "", ranked: NEVER },
      history: { days: [], mainLifts: [] },
    }));

    expect(next.rows).toHaveLength(0);
    expect(next.gap).toBeNull();
    expect(next.note).toBe(
      "Nothing logged yet. Log a session and this card ranks the muscles you owe sets to.",
    );
    // No error tone and no refusal anywhere in the empty state.
    expect(next.note).not.toMatch(/not enough|too thin|cannot|can't say/i);
  });

  it("survives an empty ranking", () => {
    const next = nextUpBlock(bootstrap({ volume: { summary: "", ranked: [] } }));
    expect(next.rows).toHaveLength(0);
    expect(next.gap).toBeNull();
    expect(next.note).not.toBeNull();
  });
});

describe("nextUpBlock — the caveat", () => {
  it("states what it is working from, and does not withhold the answer", () => {
    const next = nextUpBlock(bootstrap());

    expect(next.caveat).toBe("From 1 logged day — this sharpens every session.");
    // The rows are still there. This is the whole ruling: never refuse, always caveat.
    expect(next.rows).toHaveLength(2);
  });

  it("pluralises the day count", () => {
    const next = nextUpBlock(bootstrap({
      history: { days: [day("2026-10-21"), day("2026-10-23")], mainLifts: [] },
    }));
    expect(next.caveat).toBe("From 2 logged days — this sharpens every session.");
  });

  it("drops the caveat once there are five lift days in four weeks", () => {
    const days = ["2026-10-08", "2026-10-13", "2026-10-17", "2026-10-21", "2026-10-24"]
      .map((d) => day(d));
    expect(days).toHaveLength(THIN_LIFT_DAYS);

    const next = nextUpBlock(bootstrap({ history: { days, mainLifts: [] } }));
    expect(next.caveat).toBeNull();
  });

  it("counts only lift days inside the window", () => {
    const next = nextUpBlock(bootstrap({
      history: { days: [day("2026-09-01"), day("2026-10-21")], mainLifts: [] },
    }));
    expect(next.caveat).toBe("From 1 logged day — this sharpens every session.");
  });
});

// --------------------------------------------------------------- last session

describe("lastSessionBlock", () => {
  it("rebuilds the owner's session from lastSets alone", () => {
    const last = lastSessionBlock(bootstrap());

    expect(last).not.toBeNull();
    expect(last?.date).toBe("2026-10-21");
    expect(last?.name).toBe("Push — Chest & Front Delts");
    expect(last?.when).toBe("4d ago · 21 Oct");
    expect(last?.rows).toEqual([
      {
        exerciseId: "ex-bench",
        name: "Barbell Bench Press",
        sets: 4,
        detail: "165 × 5 × 4 sets @7",
      },
      {
        exerciseId: "ex-smith",
        name: "Smith Machine Incline Press",
        sets: 3,
        detail: "155 × 8 × 3 sets",
      },
    ]);
    expect(last?.exerciseIds).toEqual(["ex-bench", "ex-smith"]);
  });

  it("takes only the newest date, not every lift ever logged", () => {
    const last = lastSessionBlock(bootstrap({
      lastSets: {
        ...LAST_SETS,
        "ex-curl": {
          localDate: "2026-10-14", weightLb: 40, reps: 10, rpe: null, sets: 3, bestE1rmLb: null,
        },
      },
    }));

    expect(last?.date).toBe("2026-10-21");
    expect(last?.exerciseIds).toEqual(["ex-bench", "ex-smith"]);
  });

  it("orders by set count, then by name, because lastSets has no session order", () => {
    const last = lastSessionBlock(bootstrap({
      lastSets: {
        "ex-smith": {
          localDate: "2026-10-21", weightLb: 155, reps: 8, rpe: null, sets: 3, bestE1rmLb: null,
        },
        "ex-curl": {
          localDate: "2026-10-21", weightLb: 40, reps: 10, rpe: null, sets: 3, bestE1rmLb: null,
        },
        "ex-bench": {
          localDate: "2026-10-21", weightLb: 165, reps: 5, rpe: 7, sets: 4, bestE1rmLb: null,
        },
      },
    }));

    expect(last?.rows.map((r) => r.name)).toEqual([
      "Barbell Bench Press", "Dumbbell Curl", "Smith Machine Incline Press",
    ]);
  });

  it("says one set rather than 1 sets", () => {
    const last = lastSessionBlock(bootstrap({
      lastSets: {
        "ex-bench": {
          localDate: "2026-10-25", weightLb: 185, reps: 3, rpe: null, sets: 1, bestE1rmLb: null,
        },
      },
    }));

    expect(last?.rows[0].detail).toBe("185 × 3 × 1 set");
    expect(last?.when).toBe("today · 25 Oct");
  });

  it("names a lift the cached catalogue has never heard of", () => {
    const last = lastSessionBlock(bootstrap({
      lastSets: {
        "ex-unknown": {
          localDate: "2026-10-21", weightLb: 100, reps: 10, rpe: null, sets: 2, bestE1rmLb: null,
        },
      },
    }));

    expect(last?.rows[0].name).toBe("Exercise");
    // No muscles to name it from, and "Workout" beats a fabricated split name.
    expect(last?.name).toBe("Workout");
  });

  it("is null, not empty, when nothing has ever been completed", () => {
    expect(lastSessionBlock(bootstrap({ lastSets: {} }))).toBeNull();
  });
});

// ----------------------------------------------------------------- main lifts

describe("mainLiftRows", () => {
  const withLifts = (over: Partial<Bootstrap> = {}) => bootstrap({
    history: {
      days: [day("2026-10-21")],
      mainLifts: [
        { exerciseId: "ex-bench", name: "Barbell Bench Press", points: [{ date: "2026-10-21", e1rmLb: 192.5 }] },
        { exerciseId: "ex-smith", name: "Smith Machine Incline Press", points: [{ date: "2026-10-21", e1rmLb: 193.8 }] },
      ],
    },
    ...over,
  });

  it("carries the target the owner wrote for that lift", () => {
    const rows = mainLiftRows(withLifts({ goalsText: "205 bench press by December" }));

    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("Barbell Bench Press");
    expect(rows[0].goal).toBe("→ 205 by Dec");
    // One session: a point and a label, never a two-point line.
    expect(rows[0].single).toBe(true);
    expect(rows[0].deltaLabel).toBeNull();
    expect(rows[0].values).toEqual([193]);
    // No goal names the incline press, so it gets no chip.
    expect(rows[1].goal).toBeNull();
  });

  it("shows the nearest deadline when one lift carries two targets", () => {
    const rows = mainLiftRows(withLifts({
      goalsText: "bench press 205 by 2026-12-01\nbench press 225 by 2027-05-01",
    }));
    expect(rows[0].goal).toBe("→ 205 by Dec");
  });

  it("prefers a dated target over an undated one", () => {
    const rows = mainLiftRows(withLifts({
      goalsText: "bench press 225\nbench press 205 by 2026-12-01",
    }));
    expect(rows[0].goal).toBe("→ 205 by Dec");
  });

  it("drops the month when the owner wrote no date", () => {
    const rows = mainLiftRows(withLifts({ goalsText: "bench press 205" }));
    expect(rows[0].goal).toBe("→ 205 lb");
  });

  it("puts no chip on a lift with no goal text at all", () => {
    const rows = mainLiftRows(withLifts());
    expect(rows.every((r) => r.goal === null)).toBe(true);
  });

  it("ignores a sentence that names no lift this account has", () => {
    const rows = mainLiftRows(withLifts({
      goalsText: "Work on arm size\nCurrent split: chest, side delts, and biceps",
    }));
    expect(rows.every((r) => r.goal === null)).toBe(true);
  });

  it("is empty when no lift has been logged twice", () => {
    expect(mainLiftRows(bootstrap())).toEqual([]);
  });
});

// ------------------------------------------------------ real workouts

/**
 * The owner's report, as data: "it for some reason combined all my stuff into
 * one lift as it thinks today is all one day".
 *
 * Two workouts, both stored under the same date (the profile timezone was the
 * New York default, so a Sydney Monday noon was a New York Sunday). The old
 * card grouped by date and drew one session out of the two; these fixtures
 * reproduce that and pin the card to the workout instead.
 */
function workout(over: Partial<RecentWorkoutDto> & { id: string }): RecentWorkoutDto {
  return {
    name: "Workout",
    localDate: "2026-10-25",
    startedAt: "2026-10-25T12:23:40.000Z",
    durationMin: 60,
    workingSets: 0,
    exercises: [],
    ...over,
  };
}

const CHEST_DAY = workout({
  id: "w-chest",
  name: "Push — Chest & Biceps",
  startedAt: "2026-10-25T02:00:00.000Z",
  workingSets: 7,
  exercises: [
    { exerciseId: "ex-bench", sets: 4, weightLb: 165, reps: 5, rpe: 7 },
    { exerciseId: "ex-curl", sets: 3, weightLb: 30, reps: 10, rpe: null },
  ],
});

const BACK_DAY = workout({
  id: "w-back",
  name: "Pull — Upper Back & Triceps",
  startedAt: "2026-10-26T00:46:29.000Z",
  workingSets: 3,
  exercises: [{ exerciseId: "ex-hammer", sets: 3, weightLb: 35, reps: 12, rpe: 8 }],
});

describe("lastSessionBlock — from real workouts", () => {
  it("shows the newest workout alone, not every lift sharing its date", () => {
    // Both are dated 2026-10-25. The date-grouped card merged them into one
    // session of bench, curl and hammer curl; this one is the back day only.
    const last = lastSessionBlock(bootstrap({
      lastSets: {
        "ex-bench": { localDate: "2026-10-25", weightLb: 165, reps: 5, rpe: 7, sets: 4, bestE1rmLb: null },
        "ex-curl": { localDate: "2026-10-25", weightLb: 30, reps: 10, rpe: null, sets: 3, bestE1rmLb: null },
        "ex-hammer": { localDate: "2026-10-25", weightLb: 35, reps: 12, rpe: 8, sets: 3, bestE1rmLb: null },
      },
      recentWorkouts: [BACK_DAY, CHEST_DAY],
    }));

    expect(last?.name).toBe("Pull — Upper Back & Triceps");
    expect(last?.exerciseIds).toEqual(["ex-hammer"]);
    expect(last?.rows[0]).toMatchObject({ name: "Hammer Curl", detail: "35 × 12 × 3 sets @8" });
  });

  it("would have merged them under the old date grouping", () => {
    // Documents what the fallback does, so nobody "simplifies" the card back
    // onto it: same data, no recentWorkouts, three lifts in one session.
    const merged = lastSessionBlock(bootstrap({
      lastSets: {
        "ex-bench": { localDate: "2026-10-25", weightLb: 165, reps: 5, rpe: 7, sets: 4, bestE1rmLb: null },
        "ex-hammer": { localDate: "2026-10-25", weightLb: 35, reps: 12, rpe: 8, sets: 3, bestE1rmLb: null },
      },
    }));
    expect(merged?.exerciseIds.sort()).toEqual(["ex-bench", "ex-hammer"]);
  });

  it("repeats exactly the lifts of that workout, in the order they were done", () => {
    const last = lastSessionBlock(bootstrap({ recentWorkouts: [CHEST_DAY] }));
    expect(last?.exerciseIds).toEqual(["ex-bench", "ex-curl"]);
  });

  it("skips a warmup-only workout for the repeat card", () => {
    const warmups = workout({ id: "w-warm", startedAt: "2026-10-26T05:00:00.000Z" });
    const last = lastSessionBlock(bootstrap({ recentWorkouts: [warmups, CHEST_DAY] }));
    expect(last?.name).toBe("Push — Chest & Biceps");
  });

  it("says there is no last session when the server sends none", () => {
    // An empty list is an answer; it must not fall back to lastSets.
    expect(lastSessionBlock(bootstrap({ recentWorkouts: [] }))).toBeNull();
  });
});

describe("recentWorkoutRows — what can be deleted", () => {
  it("lists two workouts on one date as two rows", () => {
    const rows = recentWorkoutRows(bootstrap({ recentWorkouts: [BACK_DAY, CHEST_DAY] }));
    expect(rows.map((r) => r.id)).toEqual(["w-back", "w-chest"]);
  });

  it("summarises each one in a line", () => {
    const [row] = recentWorkoutRows(bootstrap({ recentWorkouts: [CHEST_DAY] }));
    expect(row.summary).toBe("7 sets · Barbell Bench Press, Dumbbell Curl");
    expect(row.when).toBe("today · 25 Oct");
  });

  it("names two lifts and counts the rest", () => {
    const busy = workout({
      id: "w-busy",
      workingSets: 9,
      exercises: ["ex-bench", "ex-smith", "ex-curl", "ex-crunch"].map((id) => ({
        exerciseId: id, sets: 2, weightLb: 50, reps: 10, rpe: null,
      })),
    });
    expect(recentWorkoutRows(bootstrap({ recentWorkouts: [busy] }))[0].summary)
      .toBe("9 sets · Barbell Bench Press, Smith Machine Incline Press +2");
  });

  it("still lists a warmup-only workout, since that may be the mistake", () => {
    const [row] = recentWorkoutRows(bootstrap({ recentWorkouts: [workout({ id: "w-warm" })] }));
    expect(row.summary).toBe("0 sets · warmups only");
  });

  it("lists nothing from an old bootstrap without the field", () => {
    expect(recentWorkoutRows(bootstrap())).toEqual([]);
  });
});

describe("deleteWorkoutPrompt", () => {
  const row = (workingSets: number) =>
    recentWorkoutRows(bootstrap({ recentWorkouts: [workout({ id: "w", workingSets })] }))[0];

  it("says how many sets go, because there is no undo", () => {
    expect(deleteWorkoutPrompt(row(16))).toBe("All 16 sets will be deleted with it. This cannot be undone.");
    expect(deleteWorkoutPrompt(row(1))).toBe("Its 1 set will be deleted with it. This cannot be undone.");
    expect(deleteWorkoutPrompt(row(0))).toBe("Its warmup sets will be deleted with it. This cannot be undone.");
  });
});

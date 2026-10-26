import { describe, expect, it } from "vitest";

import { CATALOGUE, TODAY } from "./fixture";
import {
  clockSecIn, dateIn, distanceMiIn, extractGoalClaims, matchExercise, repsIn, restKind,
  unitWeightLbIn, weightLbIn,
} from "./goals";
import type { CatalogueExercise } from "../../lib/types";

/**
 * Four narrow patterns over free text, and the thing being guarded is not
 * recall — it is precision. A sentence nothing matched lands in `rest` and is
 * still shown verbatim, so a miss costs nothing. A sentence matched to the
 * WRONG lift computes a gap against a lift the owner does not do, which is a
 * number they would act on, and is the same failure the parser just got fixed
 * for. Several assertions below exist only to pin a *non*-match.
 */

const extract = (text: string) => extractGoalClaims(text, CATALOGUE, TODAY);

describe("the owner's real goals_text", () => {
  const OWNER = "Running prep — half marathon in the fall. Also want to add visible "
    + "muscle size, especially shoulders and back. And abs.";

  it("finds the one measurable thing in it and reads the rest honestly", () => {
    const { claims, rest } = extract(OWNER);

    expect(claims).toEqual([{
      kind: "run_distance",
      sentence: "Running prep — half marathon in the fall",
      distanceMi: 13.1,
      byDate: null,
    }]);
    expect(rest).toEqual([
      "Also want to add visible muscle size, especially shoulders and back",
      "And abs",
    ]);
  });

  it("does not read 'marathon' as March", () => {
    // `/mar[a-z]*/` would, and the deadline would be invented out of nothing.
    expect(extract(OWNER).claims[0].byDate).toBeNull();
  });
});

describe("bodyweight", () => {
  it("reads a weight with a cue", () => {
    expect(extract("Get to 185 lb and hold it.").claims).toEqual([{
      kind: "bodyweight",
      sentence: "Get to 185 lb and hold it",
      targetLb: 185,
      byDate: null,
    }]);
  });

  it("converts kg to whole lb", () => {
    const [claim] = extract("Cut down to 80 kg.").claims;
    expect(claim).toMatchObject({ kind: "bodyweight", targetLb: 176 });
  });

  it("reads the bare number too, which is how it actually gets written", () => {
    expect(extract("Want to weigh 175 by spring.").claims[0]).toMatchObject({ targetLb: 175 });
  });

  it("needs a cue — a bare weight is not a bodyweight goal", () => {
    const { claims, rest } = extract("Add 20 lb of muscle this year");
    expect(claims).toEqual([]);
    expect(rest).toEqual(["Add 20 lb of muscle this year"]);
  });

  it("yields to a lift when the sentence names one, cue or not", () => {
    // "up to" is a bodyweight cue and 315 is a weight, so the stated pattern
    // order would file this as a bodyweight target of 315 lb.
    const [claim] = extract("Get my barbell back squat up to 315.").claims;
    expect(claim).toMatchObject({ kind: "lift", exerciseName: "Barbell Back Squat" });
  });
});

describe("lift", () => {
  it("matches on every token of the catalogue name", () => {
    expect(extract("Bench press 225 by March.").claims).toEqual([{
      kind: "lift",
      sentence: "Bench press 225 by March",
      exerciseId: "ex-bench",
      exerciseName: "Barbell Bench Press",
      targetLb: 225,
      byDate: "2027-03-01",
    }]);
  });

  it("reads the bare word 'bench' as the barbell bench, through the nickname table", () => {
    // This used to land in `rest`. It is how the main lifts are written, and
    // the nickname table maps it to exactly one slug, so it is no longer a guess.
    const { claims, rest } = extract("bench 225 by March");
    expect(claims).toEqual([{
      kind: "lift",
      sentence: "bench 225 by March",
      exerciseId: "ex-bench",
      exerciseName: "Barbell Bench Press",
      targetLb: 225,
      byDate: "2027-03-01",
    }]);
    expect(rest).toEqual([]);
  });

  it("prefers the more specific of two matching names", () => {
    const [claim] = extract("Smith machine incline press 185 lb.").claims;
    expect(claim).toMatchObject({ exerciseName: "Smith Machine Incline Press" });
  });

  it("returns nothing for an exercise the catalogue does not have", () => {
    const { claims, rest } = extract("Zercher squat 275 lb by June");
    expect(claims).toEqual([]);
    expect(rest).toEqual(["Zercher squat 275 lb by June"]);
  });

  it("needs a weight as well as a lift", () => {
    expect(extract("Want my barbell deadlift to feel easy").claims).toEqual([]);
  });
});

describe("running", () => {
  it("maps the named distances", () => {
    expect(distanceMiIn("a 5k")).toBe(3.1);
    expect(distanceMiIn("a 10k")).toBe(6.2);
    expect(distanceMiIn("half marathon")).toBe(13.1);
    expect(distanceMiIn("the marathon")).toBe(26.2);
  });

  it("does not read a half marathon as a full one", () => {
    expect(distanceMiIn("half-marathon")).toBe(13.1);
  });

  it("tells 5k from 5 miles", () => {
    expect(extract("Run a 5k.").claims[0]).toMatchObject({ distanceMi: 3.1 });
    expect(extract("Run 5 miles without stopping.").claims[0]).toMatchObject({ distanceMi: 5 });
  });

  it("reads 1:50 as h:mm on a half marathon", () => {
    expect(extract("Half marathon under 1:50.").claims).toEqual([{
      kind: "run_time",
      sentence: "Half marathon under 1:50",
      distanceMi: 13.1,
      targetSec: 6600,
      byDate: null,
    }]);
  });

  it("reads the same token as mm:ss on a 5k", () => {
    const [claim] = extract("Run a 5k in 1:50.").claims;
    expect(claim).toMatchObject({ kind: "run_time", distanceMi: 3.1, targetSec: 110 });
  });

  it("reads an explicit h:mm:ss literally", () => {
    expect(clockSecIn("marathon in 3:45:10", 26.2)).toBe(13_510);
  });

  it("falls back to a distance claim with no clock in the sentence", () => {
    expect(extract("Build up to a half marathon.").claims[0]).toMatchObject({
      kind: "run_distance",
    });
  });
});

describe("deadlines", () => {
  it("reads a bare month as its next occurrence", () => {
    expect(dateIn("by March", TODAY)).toBe("2027-03-01");
    expect(dateIn("by December", TODAY)).toBe("2026-12-01");
  });

  it("rolls a month that has already started into next year", () => {
    // TODAY is 25 October: "by October" cannot mean three weeks ago.
    expect(dateIn("by October", TODAY)).toBe("2027-10-01");
  });

  it("reads an abbreviation with or without a full stop", () => {
    expect(dateIn("by Mar.", TODAY)).toBe("2027-03-01");
    expect(dateIn("by Sept 2027", TODAY)).toBe("2027-09-01");
  });

  it("reads MMM YYYY and an ISO date exactly", () => {
    expect(dateIn("March 2028", TODAY)).toBe("2028-03-01");
    expect(dateIn("by 2027-04-18", TODAY)).toBe("2027-04-18");
  });

  it("takes the first month in the sentence, not the earliest in the calendar", () => {
    // Calendar order would answer March; what the owner wrote is June.
    expect(dateIn("by June, not March", TODAY)).toBe("2027-06-01");
  });

  it("never infers one from vague time words", () => {
    for (const vague of ["soon", "this year", "eventually", "in the fall", "by summer"]) {
      expect(dateIn(vague, TODAY)).toBeNull();
    }
  });

  it("needs a year or a day before treating 'may' as a month", () => {
    expect(dateIn("I may add a deload", TODAY)).toBeNull();
    expect(dateIn("by May 2027", TODAY)).toBe("2027-05-01");
  });
});

describe("prose with nothing extractable", () => {
  it("returns no claims and every sentence as rest — never a guess", () => {
    const text = "Feel better. Sleep more. Stop skipping warmups";
    const { claims, rest } = extract(text);
    expect(claims).toEqual([]);
    expect(rest).toEqual(["Feel better", "Sleep more", "Stop skipping warmups"]);
  });

  it("is empty for empty text", () => {
    expect(extract("")).toEqual({ claims: [], rest: [] });
    expect(extract("   \n  ")).toEqual({ claims: [], rest: [] });
  });

  it("keeps the owner's wording byte for byte", () => {
    const [claim] = extract("GET TO 185 LBS!!").claims;
    expect(claim.sentence).toBe("GET TO 185 LBS!!");
  });
});

describe("the pure helpers", () => {
  it("ignores a clock when looking for a bare weight", () => {
    expect(weightLbIn("under 1:50")).toBeNull();
    expect(weightLbIn("225 by March")).toBe(225);
  });

  it("matches nothing against an empty catalogue", () => {
    expect(matchExercise("bench press 225", [])).toBeNull();
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * The round that added rep targets, a second dated target per sentence, and
 * plural tolerance. Driven entirely by the owner's real goals_text, every
 * sentence of which is asserted below.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The catalogue plus the one row the owner's text names that the fixture lacks. */
const WITH_PULLUP: CatalogueExercise[] = [
  ...CATALOGUE,
  {
    id: "ex-wpu",
    name: "Weighted Pull-Up",
    slug: "weighted-pull-up",
    incrementLb: 5,
    equipment: "bodyweight",
    muscles: [],
  },
];

const extractFull = (text: string) => extractGoalClaims(text, WITH_PULLUP, TODAY);

/** Verbatim, newlines and all. The newlines are what split it into sentences. */
const OWNER_GOALS = [
  "Main priority is strength on compound lifts, getting arms to be bigger, and getting good strong abs.",
  "Main lifts: 205 bench press by December, 225 by May.",
  "10 weighted pull ups with 45lb plate by May",
  "Current split: chest, side delts, and biceps, back, rear delts, and triceps, legs",
  "Abs and run 2x per week",
].join("\n");

describe("the owner's goals_text, sentence by sentence", () => {
  it("finds four targets in it and leaves three sentences as prose", () => {
    const { claims, rest } = extractFull(OWNER_GOALS);

    expect(claims).toEqual([
      {
        kind: "lift",
        sentence: "Main lifts: 205 bench press by December, 225 by May",
        exerciseId: "ex-bench",
        exerciseName: "Barbell Bench Press",
        targetLb: 205,
        byDate: "2026-12-01",
      },
      {
        kind: "lift",
        sentence: "Main lifts: 205 bench press by December, 225 by May",
        exerciseId: "ex-bench",
        exerciseName: "Barbell Bench Press",
        targetLb: 225,
        byDate: "2027-05-01",
      },
      {
        kind: "lift_reps",
        sentence: "10 weighted pull ups with 45lb plate by May",
        exerciseId: "ex-wpu",
        exerciseName: "Weighted Pull-Up",
        targetReps: 10,
        loadLb: 45,
        byDate: "2027-05-01",
      },
    ]);

    expect(rest).toEqual([
      "Main priority is strength on compound lifts, getting arms to be bigger, "
        + "and getting good strong abs",
      "Current split: chest, side delts, and biceps, back, rear delts, and triceps, legs",
      "Abs and run 2x per week",
    ]);
  });

  it("files the priorities line as an aim and the other two as context", () => {
    const { rest } = extractFull(OWNER_GOALS);
    expect(rest.map(restKind)).toEqual(["aim", "context", "context"]);
  });
});

describe("plural tolerance", () => {
  it("reaches a singular catalogue name from a plural sentence", () => {
    expect(matchExercise("10 weighted pull ups", WITH_PULLUP)?.name).toBe("Weighted Pull-Up");
    expect(matchExercise("preacher curls 50 lb", WITH_PULLUP)?.name).toBe("Preacher Curl");
  });

  it("still refuses a partial name — the needle did not get looser", () => {
    // "bench" alone reaches the barbell bench only through the exact nickname
    // table; a word that merely starts with it reaches nothing.
    expect(matchExercise("bench 225 by March", WITH_PULLUP)?.name).toBe("Barbell Bench Press");
    expect(matchExercise("benches 225", WITH_PULLUP)).toBeNull();
    expect(matchExercise("benching 225", WITH_PULLUP)).toBeNull();
  });

  it("does not match a bare muscle name to anything", () => {
    for (const word of ["triceps", "abs", "biceps", "side delts", "legs"]) {
      expect(matchExercise(word, WITH_PULLUP)).toBeNull();
    }
  });
});

describe("a second dated target in one sentence", () => {
  it("reads both halves of the owner's main-lifts line", () => {
    const claims = extractFull("Main lifts: 205 bench press by December, 225 by May.").claims;
    expect(claims).toHaveLength(2);
    expect(claims[0]).toMatchObject({ targetLb: 205, byDate: "2026-12-01" });
    expect(claims[1]).toMatchObject({ targetLb: 225, byDate: "2027-05-01" });
    // Both name the same lift: the second inherits it rather than re-matching.
    expect(claims[1]).toMatchObject({ exerciseId: "ex-bench", kind: "lift" });
  });

  it("needs a month beside the second figure, so a set log stays one claim", () => {
    // The guard that matters. Without it this is four bench goals.
    const claims = extractFull("bench press 165x5, 165x5, 175x3, 155x7").claims;
    expect(claims).toEqual([]);

    const dated = extractFull("barbell back squat 315 by March, 335").claims;
    expect(dated).toHaveLength(1);
    expect(dated[0]).toMatchObject({ targetLb: 315 });
  });
});

describe("rep targets", () => {
  it("reads a leading count, the added load and the deadline", () => {
    expect(extractFull("10 weighted pull ups with 45lb plate by May").claims).toEqual([{
      kind: "lift_reps",
      sentence: "10 weighted pull ups with 45lb plate by May",
      exerciseId: "ex-wpu",
      exerciseName: "Weighted Pull-Up",
      targetReps: 10,
      loadLb: 45,
      byDate: "2027-05-01",
    }]);
  });

  it("reads the explicit form too, and leaves the load null without a unit", () => {
    const [claim] = extractFull("Barbell back squat for 5 reps at bodyweight").claims;
    expect(claim).toMatchObject({ kind: "lift_reps", targetReps: 5, loadLb: null });
  });

  it("NEVER emits a weight target from a rep sentence", () => {
    /*
     * The whole point of the guard. `45` here is a plate hung off a belt, not a
     * bench press target; read as `kind: "lift"` it would make gapFor compute
     * e1RM 180 → 45 and render an unmet goal as achieved, in good-news green.
     */
    const { claims } = extractFull("10 weighted pull ups with 45lb plate by May");
    expect(claims.every((c) => c.kind !== "lift")).toBe(true);
  });

  it("leaves a plain weight target alone — no rep count, no change", () => {
    const [claim] = extractFull("Bench press 225 by March.").claims;
    expect(claim).toMatchObject({ kind: "lift", targetLb: 225 });
  });
});

describe("'may' as a month", () => {
  it("takes a preposition as the signal, which is how the owner writes it", () => {
    expect(dateIn("225 by May", TODAY)).toBe("2027-05-01");
    expect(dateIn("45lb plate by May", TODAY)).toBe("2027-05-01");
    expect(dateIn("in May", TODAY)).toBe("2027-05-01");
  });

  it("still reads the modal verb as a verb", () => {
    expect(dateIn("I may add a deload", TODAY)).toBeNull();
    expect(dateIn("maybe a deload", TODAY)).toBeNull();
    // The first month in the sentence is still March: "I may" is not a month,
    // so it does not outrank it.
    expect(dateIn("I may add a deload in March", TODAY)).toBe("2027-03-01");
  });
});

describe("restKind", () => {
  it("files a leading label as context", () => {
    expect(restKind("Current split: chest, side delts, and biceps")).toBe("context");
    expect(restKind("Schedule: four days on, one off")).toBe("context");
    expect(restKind("Gym: the one on 5th")).toBe("context");
  });

  it("files a scheduling cue as context", () => {
    expect(restKind("Abs and run 2x per week")).toBe("context");
    expect(restKind("Deload every 6th week")).toBe("context");
    expect(restKind("Lift Mon, Wed, Fri")).toBe("context");
  });

  it("files everything else as an aim", () => {
    expect(restKind("Work on arm size")).toBe("aim");
    expect(restKind("Getting good strong abs")).toBe("aim");
    expect(restKind("Feel strong")).toBe("aim");
  });
});

describe("the helpers the new kinds added", () => {
  it("repsIn prefers the explicit form and will not read a weight", () => {
    expect(repsIn("bench 5 reps at 225")).toBe(5);
    expect(repsIn("10 weighted pull ups")).toBe(10);
    // Three digits cannot be a leading rep count.
    expect(repsIn("205 bench press by December")).toBeNull();
    expect(repsIn("Bench press 225")).toBeNull();
  });

  it("unitWeightLbIn ignores a bare figure and converts kg", () => {
    expect(unitWeightLbIn("45lb plate")).toBe(45);
    expect(unitWeightLbIn("20 kg plate")).toBe(44);
    expect(unitWeightLbIn("225 by March")).toBeNull();
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * The "bench press goal shown as Dumbbell Bench Press" bug.
 *
 * Stripping equipment words made Barbell and Dumbbell Bench Press both
 * `{bench, press}`, and "longer name wins" gave the tie to the dumbbell row by
 * one character. The fixture above has only the barbell row, which is why the
 * tie was never exercised. These use the real catalogue names and slugs.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const row = (id: string, name: string, slug: string, equipment: string): CatalogueExercise => ({
  id, name, slug, incrementLb: 5, equipment, muscles: [],
});

const BB_BENCH = row("bb-bench", "Barbell Bench Press", "barbell-bench-press", "barbell");
const DB_BENCH = row("db-bench", "Dumbbell Bench Press", "dumbbell-bench-press", "dumbbell");
const SMITH_BENCH = row("smith-bench", "Smith Machine Bench Press", "smith-machine-bench-press", "machine");
const CG_BENCH = row("cg-bench", "Close-Grip Bench Press", "close-grip-bench-press", "barbell");
const INCLINE_BB = row("incline-bb", "Incline Barbell Press", "incline-barbell-press", "barbell");
const BACK_SQUAT = row("back-squat", "Back Squat", "back-squat", "barbell");
const FRONT_SQUAT = row("front-squat", "Front Squat", "front-squat", "barbell");
const DEADLIFT = row("deadlift", "Deadlift", "deadlift", "barbell");
const OHP = row("ohp", "Overhead Press", "overhead-press", "barbell");
const DB_OHP = row("db-ohp", "Dumbbell Shoulder Press", "dumbbell-shoulder-press", "dumbbell");

/** Alphabetical, the order bootstrap sends — the dumbbell row after the barbell. */
const BENCHES = [BB_BENCH, CG_BENCH, DB_BENCH, SMITH_BENCH];
/** And the reverse, so no assertion is passing on catalogue order alone. */
const BENCHES_REVERSED = [...BENCHES].reverse();

const REAL: CatalogueExercise[] = [
  BACK_SQUAT, BB_BENCH, CG_BENCH, DEADLIFT, DB_BENCH, DB_OHP, FRONT_SQUAT, INCLINE_BB, OHP,
  SMITH_BENCH,
];

describe("matchExercise: equipment", () => {
  for (const [order, catalogue] of [["sent order", BENCHES], ["reverse", BENCHES_REVERSED]] as const) {
    describe(`with the catalogue in ${order}`, () => {
      it("reads an unqualified 'bench press' as the barbell lift", () => {
        expect(matchExercise("205 bench press by December", catalogue)?.id).toBe("bb-bench");
      });

      it("reads 'barbell bench press' as the barbell lift", () => {
        expect(matchExercise("205 barbell bench press by Dec", catalogue)?.id).toBe("bb-bench");
      });

      it("reads 'dumbbell bench press' as the dumbbell lift", () => {
        expect(matchExercise("80 dumbbell bench press", catalogue)?.id).toBe("db-bench");
      });

      it("reads 'db bench press' as the dumbbell lift", () => {
        expect(matchExercise("db bench press 80", catalogue)?.id).toBe("db-bench");
      });

      it("reads 'smith bench press' as the smith machine lift", () => {
        expect(matchExercise("smith bench press 185", catalogue)?.id).toBe("smith-bench");
      });

      it("reads 'close grip bench press' as the close-grip lift", () => {
        expect(matchExercise("close grip bench press 185", catalogue)?.id).toBe("cg-bench");
      });
    });
  }

  it("rejects a row whose implement contradicts the sentence instead of falling back", () => {
    // No dumbbell row in this catalogue. The barbell row matches on tokens but
    // names a different implement, so the honest answer is nothing.
    expect(matchExercise("80 dumbbell bench press", [BB_BENCH])).toBeNull();
    expect(matchExercise("200 barbell bench press", [DB_BENCH])).toBeNull();
  });

  it("still takes a non-barbell row when it is the only one and nothing was said", () => {
    // The default-implement rule ranks; it does not reject.
    expect(matchExercise("bench press 80", [DB_BENCH])?.id).toBe("db-bench");
  });
});

describe("matchExercise: nicknames", () => {
  it("bench → Barbell Bench Press", () => {
    expect(matchExercise("bench 225 by March", REAL)?.id).toBe("bb-bench");
  });

  it("squat → Back Squat", () => {
    expect(matchExercise("squat 315 by May", REAL)?.id).toBe("back-squat");
    expect(matchExercise("squats 315", REAL)?.id).toBe("back-squat");
  });

  it("dl → Deadlift", () => {
    expect(matchExercise("dl 405", REAL)?.id).toBe("deadlift");
  });

  it("ohp → Overhead Press", () => {
    expect(matchExercise("ohp 135 by June", REAL)?.id).toBe("ohp");
  });

  it("does not fire with a qualifier the catalogue did not resolve", () => {
    // "incline bench" is not the bench press, and "Incline Barbell Press"
    // needs "press", so the answer is nothing — never the flat bench.
    expect(matchExercise("incline bench 185", REAL)).toBeNull();
    expect(matchExercise("db bench 80", REAL)).toBeNull();
    expect(matchExercise("machine bench 200", REAL)).toBeNull();
    expect(matchExercise("box squat 275", REAL)).toBeNull();
    expect(matchExercise("sumo dl 405", REAL)).toBeNull();
  });

  it("leaves a full catalogue name to the full-name pass", () => {
    // "front squat" is in the catalogue, so the nickname is never consulted.
    expect(matchExercise("front squat 225", REAL)?.id).toBe("front-squat");
  });

  it("refuses a sentence that nicknames two lifts", () => {
    expect(matchExercise("bench 225 and squat 315", REAL)).toBeNull();
  });

  it("refuses when the catalogue has no row with that slug", () => {
    expect(matchExercise("bench 225", [DB_BENCH])).toBeNull();
  });

  it("is a whole-word lookup, not a property lookup", () => {
    expect(matchExercise("constructor 225", REAL)).toBeNull();
  });

  it("does not turn a bodyweight sentence into a lift goal", () => {
    // The nickname table made this a 175 lb BENCH target: a nickname match
    // counts as naming an exercise, which withholds the bodyweight reading.
    expect(matchExercise("cut to 175 without losing my bench", REAL)).toBeNull();
    expect(matchExercise("bulk to 190 and keep my squat", REAL)).toBeNull();
  });

  it("still reads 'up to' with a nicknamed lift as that lift", () => {
    // Why the guard is narrower than the bodyweight cue: "up to" belongs to
    // lift goals as often as to bodyweight ones.
    expect(matchExercise("get my squat up to 315 by May", REAL)?.id).toBe("back-squat");
  });
});

describe("bodyweight sentences that mention a lift", () => {
  it("come out as a bodyweight goal, not a lift goal", () => {
    const [claim] = extract("Cut to 175 without losing my bench").claims;
    expect(claim).toMatchObject({ kind: "bodyweight", targetLb: 175 });
  });
});

describe("the goals bug, end to end", () => {
  it("files the owner's main-lifts line as two barbell bench claims", () => {
    const { claims } = extractGoalClaims(
      "Main lifts: 205 bench press by December, 225 by May.",
      REAL,
      TODAY,
    );
    expect(claims.map((c) => (c.kind === "lift" ? [c.exerciseId, c.targetLb] : c.kind))).toEqual([
      ["bb-bench", 205],
      ["bb-bench", 225],
    ]);
  });

  it("files 'squat 315 by May' as a Back Squat target", () => {
    const { claims } = extractGoalClaims("squat 315 by May", REAL, TODAY);
    expect(claims).toEqual([{
      kind: "lift",
      sentence: "squat 315 by May",
      exerciseId: "back-squat",
      exerciseName: "Back Squat",
      targetLb: 315,
      byDate: "2027-05-01",
    }]);
  });
});

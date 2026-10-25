import { describe, expect, it } from "vitest";

import { CATALOGUE, TODAY } from "./fixture";
import { clockSecIn, dateIn, distanceMiIn, extractGoalClaims, matchExercise, weightLbIn } from "./goals";

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

  it("refuses to guess from a partial name", () => {
    // "bench" alone is not "Barbell Bench Press". The row lands in `rest`
    // rather than becoming a gap against a lift that was never named.
    const { claims, rest } = extract("bench 225 by March");
    expect(claims).toEqual([]);
    expect(rest).toEqual(["bench 225 by March"]);
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

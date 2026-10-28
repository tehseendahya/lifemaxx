import { describe, it, expect } from "vitest";
import {
  PACE_DISAGREEMENT_LIMIT,
  RUN_BOUNDS,
  distanceToMetres,
  durationToSeconds,
  implausibleRun,
  isDistanceUnit,
  paceDisagreement,
  printedPaceToSecPerMile,
  readingDisagrees,
  screenshotExternalId,
} from "./run-import";
import { M_PER_MILE, paceSecPerMile } from "./running";

/**
 * The screenshot path's guards.
 *
 * One error dominates this feature and every test below is built around it:
 * the unit. A run screen prints a bare number next to a unit a vision model has
 * to read off an image, and miles taken for kilometres is a 61% error applied
 * silently to every distance, pace and weekly total that follows.
 */

describe("distance, and the unit it was printed in", () => {
  it("converts each unit a running app prints", () => {
    expect(distanceToMetres(1, "mi")).toBeCloseTo(1609.344, 3);
    expect(distanceToMetres(5, "km")).toBe(5000);
    expect(distanceToMetres(400, "m")).toBe(400);
  });

  it("refuses to guess when the unit was not understood", () => {
    // The single most important assertion in this file. A default to either
    // unit is a coin flip applied to the only number that matters, and the
    // wrong side of it is undetectable downstream.
    for (const unit of ["miles", "KM", "", null, undefined, 1, "yd"]) {
      expect(distanceToMetres(6.2, unit), String(unit)).toBeNull();
    }
  });

  it("shows the size of the mistake it is preventing", () => {
    // 6.21 of something. Read as km it is a 10k; read as miles it is a
    // half-marathon, and nothing else on the screen contradicts it.
    const asKm = distanceToMetres(6.21, "km") as number;
    const asMi = distanceToMetres(6.21, "mi") as number;
    expect(asMi / asKm).toBeCloseTo(1.609, 2);
  });

  it("rejects a distance that is not a positive number", () => {
    expect(distanceToMetres(0, "mi")).toBeNull();
    expect(distanceToMetres(-3, "mi")).toBeNull();
    expect(distanceToMetres(Number.NaN, "mi")).toBeNull();
  });

  it("knows which unit strings it understands", () => {
    expect(isDistanceUnit("mi")).toBe(true);
    expect(isDistanceUnit("km")).toBe(true);
    expect(isDistanceUnit("m")).toBe(true);
    expect(isDistanceUnit("miles")).toBe(false);
  });
});

describe("the clock on the screen", () => {
  it("reads both forms a running app prints", () => {
    // Which form you get depends on how long you were out, so assuming either
    // would be wrong for half of all runs.
    expect(durationToSeconds("48:12")).toBe(48 * 60 + 12);
    expect(durationToSeconds("1:02:30")).toBe(3750);
    expect(durationToSeconds("45")).toBe(45);
    expect(durationToSeconds("  25:00 ")).toBe(1500);
  });

  it("lets the leading field run past an hour, but no other", () => {
    expect(durationToSeconds("90:00")).toBe(5400);
    // `1:75:00` is not a time any screen shows; reading it would mean the
    // fields were misaligned.
    expect(durationToSeconds("1:75:00")).toBeNull();
    expect(durationToSeconds("1:02:99")).toBeNull();
  });

  it("returns null rather than a partial reading", () => {
    for (const raw of ["", "abc", "12:", ":30", "1:2:3:4", "-5:00", "8.30"]) {
      expect(durationToSeconds(raw), raw).toBeNull();
    }
  });
});

describe("figures that cannot be a run", () => {
  const fine = (d: number | null, s: number) => expect(implausibleRun(d, s)).toBeNull();

  it("accepts the runs a person actually does", () => {
    fine(5000, 25 * 60);                 // a 5k
    fine(21097, 105 * 60);               // a half
    fine(42195, 4 * 60 * 60);            // a marathon
    fine(null, 30 * 60);                 // time only, no distance on screen
  });

  it("catches a dropped decimal point", () => {
    // `6.2` read as `62` miles. Inside the bounds for duration, nowhere near
    // it for distance.
    expect(implausibleRun(62 * M_PER_MILE, 50 * 60)).toBeNull();
    expect(implausibleRun(620 * M_PER_MILE, 50 * 60)).not.toBeNull();
  });

  it("catches a pace read as a duration", () => {
    // `8:02` taken as the whole run rather than the per-mile pace.
    expect(implausibleRun(5000, 8)).not.toBeNull();
  });

  it("holds the bounds wide enough not to argue with reality", () => {
    // These are catching misreads, not judging performance. The 24-hour world
    // record is a little over 200 miles, so the ceiling has to sit above it.
    expect(RUN_BOUNDS.maxDistanceM / M_PER_MILE).toBeGreaterThan(250);
    expect(RUN_BOUNDS.maxDurationS).toBeGreaterThan(24 * 60 * 60);
    expect(RUN_BOUNDS.minDurationS).toBeLessThanOrEqual(60);
  });
});

describe("the numbers checking each other", () => {
  /*
   * Pace IS distance over duration, so a screenshot carries its own checksum.
   * This is the only evidence available inside one image that a unit was
   * misread, and it is why the model is asked for the printed pace at all.
   */

  it("agrees when the reading is right", () => {
    // 3.1 mi in 25:00 is 8:03/mi; the screen said 8:02.
    const distanceM = 3.1 * M_PER_MILE;
    const off = paceDisagreement(distanceM, 25 * 60, 8 * 60 + 2);
    expect(off).not.toBeNull();
    expect(off as number).toBeLessThan(PACE_DISAGREEMENT_LIMIT);
    expect(readingDisagrees({
      distanceM, durationS: 25 * 60, printedPaceSecPerMile: 8 * 60 + 2,
    })).toBeNull();
  });

  it("catches the unit confusion it exists for", () => {
    /*
     * A real, self-consistent screen: 6.21 km in 48:20, which is 7:47 /km.
     *
     * The failure is the model reading the distance as 6.21 MILES while
     * reading the pace correctly. Nothing else about that reading looks
     * wrong — it is the printed pace, and only the printed pace, that
     * contradicts it.
     */
    const durationS = 48 * 60 + 20;
    const printed = printedPaceToSecPerMile("7:47", "km") as number;
    expect(printed).toBeCloseTo(751.6, 1);

    const misread = 6.21 * M_PER_MILE;
    const off = paceDisagreement(misread, durationS, printed) as number;
    expect(off).toBeGreaterThan(PACE_DISAGREEMENT_LIMIT);
    expect(readingDisagrees({ distanceM: misread, durationS, printedPaceSecPerMile: printed }))
      .toContain("units");

    // Read correctly, the same screen passes.
    const correct = 6.21 * 1000;
    expect(readingDisagrees({
      distanceM: correct, durationS, printedPaceSecPerMile: printed,
    })).toBeNull();
  });

  it("converts a per-kilometre pace before comparing it", () => {
    /*
     * Without this the check would fire on every correctly-read kilometre
     * screenshot — 7:47 /km compared against a per-mile figure is 61% out, so
     * the guard would reject exactly the readings it exists to pass.
     */
    const perKm = printedPaceToSecPerMile("7:47", "km") as number;
    const perMi = printedPaceToSecPerMile("12:31", "mi") as number;
    // The same pace to within a second — each figure is already rounded to the
    // second on the screen it was printed on, so they cannot agree exactly.
    expect(Math.abs(perKm - perMi)).toBeLessThan(1);

    const distanceM = 6.21 * 1000;
    const durationS = 48 * 60 + 20;
    expect(readingDisagrees({ distanceM, durationS, printedPaceSecPerMile: perKm })).toBeNull();

    // The bug this prevents, stated directly: taking 7:47 /km as 7:47 /mi.
    const unconverted = 7 * 60 + 47;
    expect(readingDisagrees({ distanceM, durationS, printedPaceSecPerMile: unconverted }))
      .not.toBeNull();
  });

  it("refuses a pace it cannot use", () => {
    expect(printedPaceToSecPerMile("7:47", "m")).toBeNull();
    expect(printedPaceToSecPerMile("7:47", "miles")).toBeNull();
    expect(printedPaceToSecPerMile("nonsense", "km")).toBeNull();
  });

  it("tolerates the rounding every screen already does", () => {
    // `3.1 mi` has thrown away up to 16 metres before anyone read it, and the
    // printed pace is rounded to the second. That must not read as a misread.
    const durationS = 25 * 60;
    for (const shown of [3.05, 3.1, 3.14]) {
      const distanceM = shown * M_PER_MILE;
      const printed = paceSecPerMile(3.1 * M_PER_MILE, durationS) as number;
      expect(readingDisagrees({ distanceM, durationS, printedPaceSecPerMile: printed }), String(shown))
        .toBeNull();
    }
  });

  it("says nothing when the screen printed no pace", () => {
    // Plenty of summaries show only distance and time. That is not a failure
    // and must not read as one.
    expect(paceDisagreement(5000, 1500, null)).toBeNull();
    expect(readingDisagrees({ distanceM: 5000, durationS: 1500, printedPaceSecPerMile: null }))
      .toBeNull();
    expect(readingDisagrees({ distanceM: null, durationS: 1500, printedPaceSecPerMile: 480 }))
      .toBeNull();
  });

  it("ignores a pace that is not a usable number", () => {
    expect(paceDisagreement(5000, 1500, 0)).toBeNull();
    expect(paceDisagreement(5000, 1500, Number.NaN)).toBeNull();
  });
});

describe("importing the same screenshot twice", () => {
  it("lands on one id, so the row is updated rather than doubled", () => {
    // `activities` is unique on (user_id, provider, external_id) — the same
    // index that makes the nightly Strava pull idempotent. A retry after a
    // failed save is the ordinary case, not an edge one.
    const a = screenshotExternalId(new Date("2026-10-27T14:02:00.000Z"));
    const b = screenshotExternalId(new Date("2026-10-27T14:02:41.000Z"));
    expect(a).toBe(b);
  });

  it("separates two runs that genuinely began at different times", () => {
    const morning = screenshotExternalId(new Date("2026-10-27T14:02:00.000Z"));
    const evening = screenshotExternalId(new Date("2026-10-27T23:40:00.000Z"));
    expect(morning).not.toBe(evening);
  });

  it("cannot collide with an id from another provider's path", () => {
    // Strava's ids are bare numbers and HealthKit's are UUIDs; the prefix keeps
    // this path's ids out of both spaces even though the index is already
    // scoped by provider.
    expect(screenshotExternalId(new Date("2026-10-27T14:02:00.000Z"))).toMatch(/^shot-/);
  });
});

import { describe, expect, it } from "vitest";

import { BIG_LIFT_FAMILY, E1RM_SLUGS, isE1rmLift } from "./big-lifts";
import { bySlug } from "@/db/catalogue";

/**
 * The list is closed, so the tests pin both directions: the lifts that must be
 * on it, and the near-misses (same movement, different implement) that must
 * not. A dumbbell bench slipping onto the list would put two incomparable
 * loads on one trend line.
 */
describe("isE1rmLift", () => {
  it("is true for the four main lifts", () => {
    for (const slug of ["barbell-bench-press", "back-squat", "deadlift", "overhead-press"]) {
      expect(isE1rmLift(slug)).toBe(true);
    }
  });

  it("is true for a close barbell variant", () => {
    expect(isE1rmLift("romanian-deadlift")).toBe(true);
    expect(isE1rmLift("close-grip-bench-press")).toBe(true);
  });

  it("is false for the same movement on a different implement", () => {
    for (const slug of [
      "dumbbell-bench-press",
      "smith-machine-bench-press",
      "incline-dumbbell-press",
      "dumbbell-shoulder-press",
      "machine-shoulder-press",
    ]) {
      expect(isE1rmLift(slug)).toBe(false);
    }
  });

  it("is false for an isolation lift", () => {
    expect(isE1rmLift("preacher-curl")).toBe(false);
  });

  it("does not answer true for an inherited property name", () => {
    expect(isE1rmLift("constructor")).toBe(false);
    expect(isE1rmLift("toString")).toBe(false);
  });
});

describe("the slug list", () => {
  it("is exactly the sixteen agreed lifts", () => {
    expect([...E1RM_SLUGS].sort()).toEqual([
      "back-squat",
      "barbell-bench-press",
      "box-squat",
      "close-grip-bench-press",
      "deadlift",
      "decline-barbell-press",
      "front-squat",
      "incline-barbell-press",
      "overhead-press",
      "push-press",
      "romanian-deadlift",
      "safety-bar-squat",
      "seated-overhead-press",
      "stiff-leg-deadlift",
      "sumo-deadlift",
      "trap-bar-deadlift",
    ]);
  });

  it("names only slugs the seed catalogue actually has", () => {
    // A typo here would not fail anything at runtime — the IN filter would
    // just quietly never match that lift. So it fails here instead.
    const missing = E1RM_SLUGS.filter((slug) => !bySlug.has(slug));
    expect(missing).toEqual([]);
  });

  it("names only barbell lifts", () => {
    const notBarbell = E1RM_SLUGS.filter((slug) => bySlug.get(slug)?.equipment !== "barbell");
    expect(notBarbell).toEqual([]);
  });

  it("files each lift under its family", () => {
    expect(BIG_LIFT_FAMILY["incline-barbell-press"]).toBe("bench");
    expect(BIG_LIFT_FAMILY["safety-bar-squat"]).toBe("squat");
    expect(BIG_LIFT_FAMILY["trap-bar-deadlift"]).toBe("deadlift");
    expect(BIG_LIFT_FAMILY["push-press"]).toBe("ohp");
  });
});

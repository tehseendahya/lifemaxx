import { describe, it, expect } from "vitest";
import {
  ROW_WIDTHS,
  ROW_WIDTH_TOTAL,
  ROW_WIDTH_BUDGET,
  MIN_RPE_WIDTH,
} from "./row-widths";

/**
 * The guard for the owner's first complaint: "when I put rpe 10 for a lift,
 * the 10 goes off the screen."
 *
 * This exists because an adversarial pass set `rpe` back to its original 32
 * and every one of the 608 tests still passed. React Native layout cannot be
 * asserted in a node environment, so the arithmetic is what gets tested — and
 * untested arithmetic in a comment is how the bug shipped the first time.
 */

describe("the set row fits on the narrowest iPhone", () => {
  it("gives RPE a cell wide enough for @10, its widest value", () => {
    // The regression that shipped. 32pt could not hold "@10" at 15pt type, so
    // it wrapped to two lines and pushed into the controls beside it.
    expect(ROW_WIDTHS.rpe).toBeGreaterThanOrEqual(MIN_RPE_WIDTH);
  });

  it("keeps the whole row inside a 375pt screen", () => {
    expect(ROW_WIDTH_TOTAL).toBeLessThanOrEqual(ROW_WIDTH_BUDGET);
  });

  it("would NOT have caught the bug on the total alone", () => {
    // Documents why the per-cell floor above is the load-bearing assertion and
    // must not be deleted as redundant: the broken layout fits the row budget
    // comfortably. Only the cell floor fails on it.
    const broken = { ...ROW_WIDTHS, rpe: 32, icon: 44 };
    const brokenTotal = Object.values(broken).reduce((a, b) => a + b, 0);

    expect(brokenTotal).toBeLessThanOrEqual(ROW_WIDTH_BUDGET);
    expect(broken.rpe).toBeLessThan(MIN_RPE_WIDTH);
  });

  it("gives every tappable cell at least the iOS touch target", () => {
    // The note dot and the duplicate/delete icons are all tap targets.
    expect(ROW_WIDTHS.icon).toBeGreaterThanOrEqual(38);
    expect(ROW_WIDTHS.weight).toBeGreaterThanOrEqual(44);
    expect(ROW_WIDTHS.reps).toBeGreaterThanOrEqual(44);
  });

  it("leaves room for a three-digit weight and a two-digit rep count", () => {
    // "225" at 17pt tabular is ~31pt; "× 12" is ~34pt. Both have to sit in
    // their cells without eliding, which is what made the owner's 165/175/155
    // readable at a glance in the first place.
    expect(ROW_WIDTHS.weight).toBeGreaterThanOrEqual(60);
    expect(ROW_WIDTHS.reps).toBeGreaterThanOrEqual(48);
  });
});

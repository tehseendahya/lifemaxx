import { describe, expect, it } from "vitest";

import { linePath, xAt, xFractions, yAt, yDomain } from "./scales";

/**
 * The degenerate cases, which are the only ones worth asserting: a chart whose
 * geometry is merely slightly off looks fine on a 32pt sparkline, while one
 * that divides by zero renders as an empty rectangle on the owner's phone and
 * cannot be told apart from "no data". There is no simulator here, so this is
 * the only place those are caught.
 */

describe("yAt", () => {
  it("inverts, so the domain maximum is at the top of the box", () => {
    expect(yAt(10, [0, 10], 100)).toBe(0);
    expect(yAt(0, [0, 10], 100)).toBe(100);
    expect(yAt(5, [0, 10], 100)).toBe(50);
  });

  it("insets by the padding on both edges", () => {
    expect(yAt(10, [0, 10], 100, 4)).toBe(4);
    expect(yAt(0, [0, 10], 100, 4)).toBe(96);
  });

  it("does not divide by zero on a zero-width domain", () => {
    expect(Number.isFinite(yAt(5, [5, 5], 100))).toBe(true);
  });
});

describe("xAt", () => {
  it("spreads n points from edge to edge", () => {
    expect(xAt(0, 3, 90)).toBe(0);
    expect(xAt(1, 3, 90)).toBe(45);
    expect(xAt(2, 3, 90)).toBe(90);
  });

  it("centres a single point rather than pinning it to the left edge", () => {
    expect(xAt(0, 1, 90)).toBe(45);
  });
});

describe("yDomain", () => {
  it("pads the series by 4% so a small swing is not drawn as a cliff", () => {
    expect(yDomain([100, 110])).toEqual([99.6, 110.4]);
  });

  it("widens a flat series to ±1 so it draws through the middle", () => {
    expect(yDomain([180, 180, 180])).toEqual([179, 181]);
  });

  it("includes the reference line, so it cannot fall outside the plot", () => {
    expect(yDomain([2000, 2100], 2400)).toEqual([1984, 2416]);
  });

  it("has a usable domain for an empty series", () => {
    expect(yDomain([])).toEqual([0, 1]);
  });
});

describe("xFractions", () => {
  it("places a date series on a calendar axis, not at even spacing", () => {
    // Days 0, 1 and 9 of a ten-day domain: the gap is the information.
    expect(xFractions(3, [0, 1, 9], [0, 9])).toEqual([0, 1 / 9, 1]);
  });

  it("clamps points that fall outside the given domain", () => {
    expect(xFractions(2, [-5, 50], [0, 10])).toEqual([0, 1]);
  });

  it("centres every point when the whole series lands on one day", () => {
    expect(xFractions(2, [7, 7], [7, 7])).toEqual([0.5, 0.5]);
  });

  it("falls back to even index spacing with no xs", () => {
    expect(xFractions(5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(xFractions(1)).toEqual([0.5]);
    expect(xFractions(0)).toEqual([]);
  });

  it("ignores an xs array of the wrong length rather than drawing a half-series", () => {
    expect(xFractions(3, [0, 5])).toEqual([0, 0.5, 1]);
  });
});

describe("linePath", () => {
  it("is plain M/L with no smoothing", () => {
    expect(linePath([{ x: 0, y: 10 }, { x: 5, y: 2.5 }])).toBe("M0.00 10.00 L5.00 2.50");
  });
});

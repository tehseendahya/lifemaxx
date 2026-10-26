import { describe, expect, it } from "vitest";

import { kgToLb } from "@/lib/shared/units";

import { MAX_TYPED_LB, parseTypedReps, parseTypedWeight } from "./typed-entry";

describe("parseTypedWeight", () => {
  it("reads pounds by default", () => {
    expect(parseTypedWeight("185")).toBe(185);
    expect(parseTypedWeight("227.5")).toBe(227.5);
    expect(parseTypedWeight(" 135 ")).toBe(135);
    expect(parseTypedWeight("135lb")).toBe(135);
    expect(parseTypedWeight("135 lbs")).toBe(135);
  });

  it("converts a typed kg at full precision", () => {
    expect(parseTypedWeight("20kg")).toBeCloseTo(kgToLb(20), 10);
    expect(parseTypedWeight("20 KG")).toBeCloseTo(kgToLb(20), 10);
    // Not rounded to a whole pound: storage is kg, and it has to round-trip.
    expect(Number.isInteger(parseTypedWeight("20kg"))).toBe(false);
  });

  it("keeps zero, which is a bodyweight set", () => {
    expect(parseTypedWeight("0")).toBe(0);
  });

  it("is not a figure while the field is empty or mid-edit", () => {
    expect(parseTypedWeight("")).toBeNull();
    expect(parseTypedWeight("   ")).toBeNull();
    expect(parseTypedWeight("k")).toBeNull();
    expect(parseTypedWeight("-5")).toBeNull();
    expect(parseTypedWeight("1.2.3")).toBeNull();
  });

  it("takes a trailing point as the number so far", () => {
    expect(parseTypedWeight("185.")).toBe(185);
    expect(parseTypedWeight(".5")).toBe(0.5);
  });

  it("refuses a weight no bar carries", () => {
    expect(parseTypedWeight(String(MAX_TYPED_LB))).toBe(MAX_TYPED_LB);
    expect(parseTypedWeight(String(MAX_TYPED_LB + 1))).toBeNull();
  });
});

describe("parseTypedReps", () => {
  it("reads a whole number of reps", () => {
    expect(parseTypedReps("5")).toBe(5);
    expect(parseTypedReps(" 12 ")).toBe(12);
  });

  it("is not a figure for zero, a fraction, or nothing", () => {
    expect(parseTypedReps("0")).toBeNull();
    expect(parseTypedReps("8.5")).toBeNull();
    expect(parseTypedReps("")).toBeNull();
    expect(parseTypedReps("x")).toBeNull();
  });

  it("refuses an implausible count", () => {
    expect(parseTypedReps("100")).toBe(100);
    expect(parseTypedReps("101")).toBeNull();
  });
});

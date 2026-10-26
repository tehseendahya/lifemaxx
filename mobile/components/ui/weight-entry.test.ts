import { describe, it, expect } from "vitest";
import {
  enteredWeightToLb,
  lbToEnteredWeight,
  equivalentLabel,
} from "./weight-entry";
import { lbToKg } from "@/lib/shared/units";

describe("committing a kg entry", () => {
  it("round-trips a whole kg exactly, which is the point", () => {
    // Storage is kg. The owner types 20 on a stack labelled 20; the server
    // must store 20.000, not 19.96. This only holds because nothing rounds
    // between the pad and the wire.
    for (const kg of [2.5, 5, 10, 17.5, 20, 30, 45, 60, 100]) {
      const wire = enteredWeightToLb(kg, "kg");
      expect(lbToKg(wire)).toBeCloseTo(kg, 10);
    }
  });

  it("leaves a pound entry completely alone", () => {
    for (const lb of [45, 135, 165, 175, 225, 315]) {
      expect(enteredWeightToLb(lb, "lb")).toBe(lb);
    }
  });

  it("would lose the weight if the conversion were rounded", () => {
    // Documents why `enteredWeightToLb` must not round, so nobody "tidies" it
    // later: a whole-pound result stores a different weight than was entered.
    const sloppy = Math.round(enteredWeightToLb(20, "kg"));
    expect(lbToKg(sloppy)).not.toBeCloseTo(20, 2);
    expect(lbToKg(sloppy)).toBeCloseTo(19.96, 2);
  });

  it("prefills the pad in whichever unit is showing", () => {
    expect(lbToEnteredWeight(165, "lb")).toBe(165);
    expect(lbToEnteredWeight(enteredWeightToLb(20, "kg"), "kg")).toBeCloseTo(20, 10);
  });
});

describe("the equivalent line", () => {
  it("shows whole pounds for a kg entry", () => {
    // The owner reported "8r@44.1lb" as looking broken, and no gym has a
    // 0.1lb plate.
    expect(equivalentLabel(20, "kg")).toBe("44 lb");
    expect(equivalentLabel(30, "kg")).toBe("66 lb");
    expect(equivalentLabel(2.5, "kg")).toBe("6 lb");
  });

  it("keeps one decimal for a kg equivalent, because 1 kg is 2.2 lb", () => {
    expect(equivalentLabel(165, "lb")).toBe("74.8 kg");
    expect(equivalentLabel(166, "lb")).toBe("75.3 kg");
    expect(equivalentLabel(45, "lb")).toBe("20.4 kg");
  });

  it("would collapse distinct weights if kg were rounded whole", () => {
    // Why the decimal above is not fussiness: 165 lb and 166 lb are both
    // "75 kg" to the nearest kilo, so a whole-number kg equivalent would show
    // the same figure for two different weights on the same lift.
    const whole = (lb: number) => Math.round(lb / 2.2046226218487757);
    expect(whole(165)).toBe(whole(166));
    expect(equivalentLabel(165, "lb")).not.toBe(equivalentLabel(166, "lb"));
  });

  it("says nothing when nothing has been typed", () => {
    // No "0 lb" flashing at someone who has not entered anything yet.
    expect(equivalentLabel(null, "kg")).toBeNull();
    expect(equivalentLabel(0, "kg")).toBeNull();
    expect(equivalentLabel(null, "lb")).toBeNull();
  });

  it("survives a value the pad could not parse", () => {
    expect(equivalentLabel(Number.NaN, "kg")).toBeNull();
    expect(equivalentLabel(Number.POSITIVE_INFINITY, "lb")).toBeNull();
  });
});

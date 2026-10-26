import { describe, it, expect } from "vitest";
import { KIND_LABEL, SET_KINDS, kindFlags, setKindOf, type SetKind } from "./set-kind";

/**
 * The guard for the owner's complaint: "You shouldn't be able to click both
 * warmup and failure, should be one or the other."
 *
 * Two controls write this pair — the session card and the confirmation sheet —
 * so the property that matters is not "the function is right" but "there is
 * exactly one function". These tests assert the round trip, which is what makes
 * a shared module worth having.
 */

describe("one question, three answers", () => {
  it("round-trips every kind through the flags and back", () => {
    for (const kind of SET_KINDS) {
      expect(setKindOf(kindFlags(kind))).toBe(kind);
    }
  });

  it("never writes both flags at once", () => {
    // The bug, stated as a property. A patch that set only the flag being
    // turned on is how the two came apart, so `kindFlags` returns both and
    // neither pair it can produce has both true.
    for (const kind of SET_KINDS) {
      const flags = kindFlags(kind);
      expect(flags.isWarmup && flags.toFailure).toBe(false);
    }
  });

  it("reads the three states a set can be in", () => {
    expect(setKindOf({ isWarmup: false, toFailure: false })).toBe("working");
    expect(setKindOf({ isWarmup: true, toFailure: false })).toBe("warmup");
    expect(setKindOf({ isWarmup: false, toFailure: true })).toBe("failure");
  });

  it("resolves the impossible fourth state to failure", () => {
    // Unreachable through either control now, but still reachable: the parser
    // can produce it from "warmup set to failure", and rows written before this
    // rule existed may hold it. Failure is the louder of the two and the one
    // progression cares about.
    expect(setKindOf({ isWarmup: true, toFailure: true })).toBe("failure");
  });

  it("clears the stale flag the first time the user touches it", () => {
    const broken = { isWarmup: true, toFailure: true };
    const healed = kindFlags(setKindOf(broken));
    expect(healed).toEqual({ isWarmup: false, toFailure: true });
  });

  it("offers warmup first and labels every kind", () => {
    // Order is the control's order: a warmup comes before the work, and the
    // commonest answer should not be at either end where a thumb lands by
    // accident.
    expect(SET_KINDS).toEqual(["warmup", "working", "failure"]);
    for (const kind of SET_KINDS) {
      expect(KIND_LABEL[kind]).toMatch(/^[A-Z]+$/);
    }
  });

  it("keeps every label short enough for a third of a 375pt screen", () => {
    // `TO FAILURE` was the session card's wording and does not fit three
    // across; the distinguishing word is the last one, so the first is dropped.
    for (const kind of SET_KINDS) {
      expect(KIND_LABEL[kind].length).toBeLessThanOrEqual(8);
    }
  });

  it("has a label for every kind in the union", () => {
    // Catches a fourth kind added to the type without a label or a segment.
    const kinds: SetKind[] = [...SET_KINDS];
    expect(Object.keys(KIND_LABEL).sort()).toEqual([...kinds].sort());
  });
});

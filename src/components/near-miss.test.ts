import { describe, it, expect } from "vitest";
import { nearMissQuestions, type WireEntry } from "./near-miss";

const BENCH = { id: "ex-bench", name: "Barbell Bench Press", confidence: "exact" };

function entry(over: Partial<WireEntry>): WireEntry {
  return { query: "bench", exercise: BENCH, sets: [{}], ...over };
}

describe("when to ask", () => {
  it("asks nothing when nothing resembles anything", () => {
    expect(nearMissQuestions([entry({})])).toEqual([]);
  });

  it("asks nothing when the entry failed to resolve at all", () => {
    // Those go to the existing "Couldn't match" path, not to a question.
    expect(nearMissQuestions([entry({ exercise: null, nearMiss: BENCH })])).toEqual([]);
  });

  it("asks about a row this request created when an older one is close", () => {
    const qs = nearMissQuestions([entry({
      query: "bnch pres",
      exercise: { id: "ex-new", name: "Bnch Pres", confidence: "new" },
      nearMiss: { id: "ex-bench", name: "Barbell Bench Press" },
    })]);

    expect(qs).toHaveLength(1);
    expect(qs[0].createdId).toBe("ex-new");
    expect(qs[0].suggestion.id).toBe("ex-bench");
    expect(qs[0].prompt).toContain("bnch pres");
    expect(qs[0].prompt).toContain("Barbell Bench Press");
  });

  it("does NOT offer to delete anything on a merely fuzzy match", () => {
    // The row already existed. Deleting it because a second row is also close
    // would destroy history that has nothing to do with this paste.
    const qs = nearMissQuestions([entry({
      query: "jm press",
      exercise: { id: "ex-ohp", name: "Overhead Press", confidence: "fuzzy" },
      nearMiss: { id: "ex-cg", name: "Close-Grip Bench Press" },
    })]);

    expect(qs).toHaveLength(1);
    expect(qs[0].createdId).toBeNull();
  });

  it("stays silent when the near miss IS the row that was matched", () => {
    // A fuzzy match carries itself as the candidate, so this would be
    // "did you mean X?" about X — a question whose answer changes nothing.
    const qs = nearMissQuestions([entry({
      exercise: { id: "ex-bench", name: "Barbell Bench Press", confidence: "fuzzy" },
      nearMiss: { id: "ex-bench", name: "Barbell Bench Press" },
    })]);
    expect(qs).toEqual([]);
  });

  it("reports the index so the caller can re-file the right entry", () => {
    const qs = nearMissQuestions([
      entry({}),
      entry({
        query: "preachr",
        exercise: { id: "ex-new", name: "Preachr", confidence: "new" },
        nearMiss: { id: "ex-pc", name: "Preacher Curl" },
      }),
      entry({}),
    ]);
    expect(qs.map((q) => q.index)).toEqual([1]);
  });

  it("asks once per entry, in the order they were typed", () => {
    const qs = nearMissQuestions([
      entry({
        query: "a",
        exercise: { id: "ex-a", name: "A", confidence: "new" },
        nearMiss: { id: "ex-a2", name: "A Two" },
      }),
      entry({
        query: "b",
        exercise: { id: "ex-b", name: "B", confidence: "new" },
        nearMiss: { id: "ex-b2", name: "B Two" },
      }),
    ]);
    expect(qs.map((q) => q.query)).toEqual(["a", "b"]);
  });

  it("falls back to the exercise name when the wire omitted the query", () => {
    const qs = nearMissQuestions([{
      exercise: { id: "ex-new", name: "Zorbax Thruster", confidence: "new" },
      nearMiss: { id: "ex-z", name: "Zorbax Press" },
      sets: [{}],
    }]);
    expect(qs[0].query).toBe("Zorbax Thruster");
    expect(qs[0].prompt).toContain("Zorbax Thruster");
  });
});

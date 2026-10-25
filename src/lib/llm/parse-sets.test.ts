import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { MockOpenAI } from "./__testing__/mock-openai";
import { OpenAiProvider } from "./openai";
import type { LlmProvider } from "./provider";
import type { ResolvedExercise } from "@/lib/exercises";

/**
 * `parseSetsText` — the one parse path, now shared by three callers.
 *
 * Two things are stubbed and nothing else. The database is stubbed because
 * there is none in this container and `resolveExerciseOutcome` is a two-query
 * trigram lookup against seeded rows; what matters here is that every entry
 * gets exactly one resolution attempt, inside `withUser`, that an unknown name
 * is CREATED rather than dropped, and that a near miss is created AND asked
 * about rather than one or the other.
 *
 * `hasNameBeyondSetNotation` is deliberately NOT stubbed. It is the guard that
 * keeps the automatic path from writing a row called "225x5", and a stub would
 * make the test that proves it meaningless.
 *
 * The model is a real `OpenAiProvider` pointed at the local contract-checking
 * stand-in (see __testing__/mock-openai.ts), not a hand-written fake — so the
 * prose path proves the request this function builds is one the API would
 * accept, with no network involved.
 */

const hoisted = vi.hoisted(() => ({ provider: null as LlmProvider | null }));

vi.mock("@/lib/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm")>()),
  getLlm: () => hoisted.provider!,
}));

const withUserCalls = { count: 0 };

vi.mock("@/db", () => ({
  withUser: <T>(_userId: string, fn: () => Promise<T>): Promise<T> => {
    withUserCalls.count += 1;
    return fn();
  },
}));

vi.mock("@/lib/exercises", async () => {
  const actual = await vi.importActual<typeof import("@/lib/exercises")>("@/lib/exercises");
  return {
    hasNameBeyondSetNotation: actual.hasNameBeyondSetNotation,
    resolveExerciseOutcome: vi.fn(),
    createUserExercise: vi.fn(),
  };
});

const { parseSetsText } = await import("./parse-sets");
const { resolveExerciseOutcome, createUserExercise } = await import("@/lib/exercises");

/** `resolveExerciseOutcome`'s happy answer, which is the common case. */
const matched = (exercise: ResolvedExercise) => ({ kind: "match" as const, exercise });

const mock = new MockOpenAI();

const EXACT: ResolvedExercise = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Barbell Bench Press",
  slug: "barbell-bench-press",
  incrementKg: 2.5,
  equipment: "barbell",
  confidence: "exact",
};

const FUZZY: ResolvedExercise = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Weighted Pull-up",
  slug: "weighted-pull-up",
  incrementKg: 2.5,
  equipment: "bodyweight",
  confidence: "fuzzy",
};

/** What `createUserExercise` hands back. `confidence` is overwritten with "new". */
const CREATED = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Zercher Goblet Thruster",
  slug: "zercher-goblet-thruster-custom",
  incrementKg: 2.26796,
  equipment: "",
  confidence: "exact" as const,
  muscles: [],
  musclesInferred: false,
};

/** The target phrase from the spec. Deliberately prose: the shorthand parser declines it. */
const PROSE = "did 3 sets weighted pull ups 45lbs for 6 reps";

const PROSE_REPLY = JSON.stringify({
  entries: [{
    exercise_query: "weighted pull ups",
    sets: Array.from({ length: 3 }, () => ({
      reps: 6, weight_lb: 45, rpe: null, to_failure: false, is_warmup: false,
    })),
  }],
});

beforeAll(async () => {
  const baseURL = await mock.start();
  hoisted.provider = new OpenAiProvider("test-key", { baseURL, maxRetries: 0, timeoutMs: 5_000 });
});

afterAll(() => mock.stop());

beforeEach(() => {
  mock.requests.length = 0;
  withUserCalls.count = 0;
  vi.mocked(resolveExerciseOutcome).mockReset();
  vi.mocked(createUserExercise).mockReset();
});

describe("parseSetsText", () => {
  it("uses the deterministic parser and never calls the model for shorthand", async () => {
    vi.mocked(resolveExerciseOutcome).mockResolvedValue(matched(EXACT));

    const result = await parseSetsText("bench 5x5 185", "user-1");

    expect(result.usedModel).toBe(false);
    expect(mock.requests).toHaveLength(0);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].query).toBe("bench");
    expect(result.entries[0].sets).toHaveLength(5);
    expect(result.entries[0].sets[0]).toMatchObject({ reps: 5, weight_lb: 185 });
    expect(result.unresolved).toEqual([]);
  });

  it("falls through to the model for prose and lands the spec's phrase as three sets", async () => {
    mock.next = { kind: "json", content: PROSE_REPLY };
    vi.mocked(resolveExerciseOutcome).mockResolvedValue(matched(FUZZY));

    const result = await parseSetsText(PROSE, "user-1");

    expect(result.usedModel).toBe(true);
    expect(mock.requests).toHaveLength(1);
    // The prompt prefix must stay byte-stable for caching, so the system
    // message is checked by identity rather than by substring.
    expect(mock.last().messages[0].role).toBe("system");
    expect(mock.last().messages[1]).toMatchObject({ role: "user", content: PROSE });
    expect(mock.last().response_format?.json_schema?.name).toBe("parsed_sets");

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].query).toBe("weighted pull ups");
    expect(result.entries[0].sets).toHaveLength(3);
    expect(result.entries[0].sets.every((s) => s.reps === 6 && s.weight_lb === 45)).toBe(true);
    expect(result.entries[0].exercise?.id).toBe(FUZZY.id);
  });

  it("marks an exact resolution as exact and resolves inside withUser", async () => {
    vi.mocked(resolveExerciseOutcome).mockResolvedValue(matched(EXACT));

    const result = await parseSetsText("bench 185x5", "user-1");

    expect(result.entries[0].exercise).toMatchObject({ confidence: "exact", name: "Barbell Bench Press" });
    expect(vi.mocked(resolveExerciseOutcome)).toHaveBeenCalledWith("bench", "user-1");
    // One transaction for the whole batch, opened after the parse — not one per
    // entry, and never around the model call.
    expect(withUserCalls.count).toBe(1);
  });

  it("surfaces a fuzzy resolution as fuzzy rather than silently accepting it", async () => {
    vi.mocked(resolveExerciseOutcome).mockResolvedValue(matched(FUZZY));

    const result = await parseSetsText("weighted pullups bw+45 for 6", "user-1");

    expect(result.entries[0].exercise?.confidence).toBe("fuzzy");
    // The raw query survives resolution: the UI shows `heard: "..."` under a
    // fuzzy chip, and re-filing the row needs the original wording to learn.
    expect(result.entries[0].query).toBe("weighted pullups");
    expect(result.unresolved).toEqual([]);
    // A fuzzy match carries ITSELF as the question. The matcher picking a
    // different lift that shares a head noun is the likelier error, and it is
    // the one the owner hit with "incline smith press" -> Incline Barbell
    // Press, so the sheet gets something to offer rather than only a `~`.
    expect(result.entries[0].nearMiss).toEqual({ id: FUZZY.id, name: FUZZY.name });
  });

  it("CREATES an unknown exercise and marks it new, costing zero taps", async () => {
    vi.mocked(resolveExerciseOutcome).mockResolvedValue({ kind: "new" });
    vi.mocked(createUserExercise).mockResolvedValue(CREATED);

    const result = await parseSetsText("zercher goblet thrusters 95x8", "user-1");

    expect(vi.mocked(createUserExercise)).toHaveBeenCalledWith("zercher goblet thrusters", "user-1");
    expect(result.entries[0].exercise).toMatchObject({
      id: CREATED.id,
      name: "Zercher Goblet Thruster",
      confidence: "new",
    });
    expect(result.entries[0].sets).toHaveLength(1);
    // The whole point: nothing is unresolved, so nothing needs fixing, so the
    // sets are loggable straight away. This is the dead end the round removed.
    expect(result.unresolved).toEqual([]);
    expect(result.entries[0].nearMiss ?? null).toBeNull();
  });

  it("creates a near miss AND asks about it, rather than one or the other", async () => {
    vi.mocked(resolveExerciseOutcome).mockResolvedValue({
      kind: "near_miss",
      candidate: { ...EXACT, confidence: "none" },
      score: 0.42,
    });
    vi.mocked(createUserExercise).mockResolvedValue({ ...CREATED, name: "Bnch Pres" });

    const result = await parseSetsText("bnch pres 185x5", "user-1");

    // Created, so the sets log with no taps if the name really was new.
    expect(result.entries[0].exercise?.confidence).toBe("new");
    // And asked about, so a typo is caught before it becomes a second bench
    // press with half a year of history behind it.
    expect(result.entries[0].nearMiss).toEqual({ id: EXACT.id, name: EXACT.name });
    expect(result.unresolved).toEqual([]);
  });

  it("refuses to create a row from set notation, leaving it unresolved", async () => {
    vi.mocked(resolveExerciseOutcome).mockResolvedValue({ kind: "new" });

    // What the model hands back when it cannot find a name. The shorthand
    // parser needs one before the first number, so "225x5" reaches the model,
    // and `exercise_query: "225x5"` is the documented shape of what comes
    // back. Creating from it would leave a lift called "225x5" in the owner's
    // picker forever.
    mock.next = { kind: "json", content: JSON.stringify({
      entries: [{
        exercise_query: "225x5",
        sets: [{ reps: 5, weight_lb: 225, rpe: null, to_failure: false, is_warmup: false }],
      }],
    }) };

    const result = await parseSetsText("225x5", "user-1");

    expect(vi.mocked(createUserExercise)).not.toHaveBeenCalled();
    expect(result.entries.every((e) => e.exercise === null)).toBe(true);
  });

  it("leaves the entry unresolved when the creation fails, rather than losing the paste", async () => {
    vi.mocked(resolveExerciseOutcome).mockResolvedValue({ kind: "new" });
    vi.mocked(createUserExercise).mockRejectedValue(new Error("no free slug"));

    const result = await parseSetsText("zercher goblet thrusters 95x8", "user-1");

    // An unmatched chip with a working picker behind it costs two taps. A
    // throw here would cost the user every line they typed.
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].sets).toHaveLength(1);
    expect(result.unresolved).toEqual(["zercher goblet thrusters"]);
  });

  it("creates ONE row when two lines of one paste name the same unknown lift", async () => {
    /*
     * The reason step 3 is sequential rather than `Promise.all`. Run
     * concurrently, both lines resolve to nothing and both create a row — two
     * exercises for one movement, from a single paste, with the history split
     * from the first day. Run in order, the first creates it and learns the
     * wording, so the second resolves exactly.
     */
    const learned = new Map<string, ResolvedExercise>();
    vi.mocked(resolveExerciseOutcome).mockImplementation(async (query: string) => {
      const hit = learned.get(query);
      return hit ? { kind: "match" as const, exercise: hit } : { kind: "new" as const };
    });
    vi.mocked(createUserExercise).mockImplementation(async (typed: string) => {
      learned.set(typed, { ...CREATED, confidence: "exact" });
      return CREATED;
    });

    const result = await parseSetsText("zercher thrusters 95x8\nzercher thrusters 95x6", "user-1");

    expect(vi.mocked(createUserExercise)).toHaveBeenCalledTimes(1);
    expect(result.entries.map((e) => e.exercise?.id)).toEqual([CREATED.id, CREATED.id]);
    // Two groups, one exercise — which is what the confirmation sheet draws,
    // since it groups by entry and not by exercise id.
    expect(result.entries).toHaveLength(2);
  });

  it("resolves each exercise of a multi-exercise entry independently", async () => {
    vi.mocked(resolveExerciseOutcome).mockImplementation(async (query: string) =>
      query === "bench" ? matched(EXACT) : { kind: "new" as const });
    vi.mocked(createUserExercise).mockResolvedValue(CREATED);

    const result = await parseSetsText("bench 5x5 185; zercher thrusters 95x8", "user-1");

    expect(result.usedModel).toBe(false);
    expect(result.entries.map((e) => e.exercise?.id ?? null)).toEqual([EXACT.id, CREATED.id]);
    expect(result.entries.map((e) => e.exercise?.confidence)).toEqual(["exact", "new"]);
    expect(result.unresolved).toEqual([]);
  });

  it("returns no entries rather than throwing when the model finds nothing set-shaped", async () => {
    mock.next = { kind: "json", content: JSON.stringify({ entries: [] }) };

    const result = await parseSetsText("what should I do next?", "user-1");

    expect(result.usedModel).toBe(true);
    expect(result.entries).toEqual([]);
    expect(result.unresolved).toEqual([]);
    // Nothing to resolve, but the transaction still opens — a zero-entry batch
    // is a normal outcome, not an error, and the caller shows "couldn't parse
    // that" with the text preserved.
    expect(vi.mocked(resolveExerciseOutcome)).not.toHaveBeenCalled();
  });
});

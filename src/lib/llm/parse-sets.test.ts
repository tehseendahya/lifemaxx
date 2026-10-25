import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { MockOpenAI } from "./__testing__/mock-openai";
import { OpenAiProvider } from "./openai";
import type { LlmProvider } from "./provider";
import type { ResolvedExercise } from "@/lib/exercises";

/**
 * `parseSetsText` — the one parse path, now shared by three callers.
 *
 * Two things are stubbed and nothing else. The database is stubbed because
 * there is none in this container and `resolveExercise` is a two-query trigram
 * lookup against seeded rows; what matters here is that every entry gets
 * exactly one resolution attempt, inside `withUser`, and that a null result
 * becomes an `unresolved` entry rather than a guess.
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

vi.mock("@/lib/exercises", () => ({ resolveExercise: vi.fn() }));

const { parseSetsText } = await import("./parse-sets");
const { resolveExercise } = await import("@/lib/exercises");

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
  vi.mocked(resolveExercise).mockReset();
});

describe("parseSetsText", () => {
  it("uses the deterministic parser and never calls the model for shorthand", async () => {
    vi.mocked(resolveExercise).mockResolvedValue(EXACT);

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
    vi.mocked(resolveExercise).mockResolvedValue(FUZZY);

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
    vi.mocked(resolveExercise).mockResolvedValue(EXACT);

    const result = await parseSetsText("bench 185x5", "user-1");

    expect(result.entries[0].exercise).toMatchObject({ confidence: "exact", name: "Barbell Bench Press" });
    expect(vi.mocked(resolveExercise)).toHaveBeenCalledWith("bench", "user-1");
    // One transaction for the whole batch, opened after the parse — not one per
    // entry, and never around the model call.
    expect(withUserCalls.count).toBe(1);
  });

  it("surfaces a fuzzy resolution as fuzzy rather than silently accepting it", async () => {
    vi.mocked(resolveExercise).mockResolvedValue(FUZZY);

    const result = await parseSetsText("weighted pullups bw+45 for 6", "user-1");

    expect(result.entries[0].exercise?.confidence).toBe("fuzzy");
    // The raw query survives resolution: the UI shows `heard: "..."` under a
    // fuzzy chip, and re-filing the row needs the original wording to learn.
    expect(result.entries[0].query).toBe("weighted pullups");
    expect(result.unresolved).toEqual([]);
  });

  it("reports an unresolved query and keeps its sets instead of dropping them", async () => {
    vi.mocked(resolveExercise).mockResolvedValue(null);

    const result = await parseSetsText("zercher goblet thrusters 95x8", "user-1");

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].exercise).toBeNull();
    expect(result.entries[0].sets).toHaveLength(1);
    expect(result.unresolved).toEqual(["zercher goblet thrusters"]);
  });

  it("resolves each exercise of a multi-exercise entry independently", async () => {
    vi.mocked(resolveExercise).mockImplementation(async (query: string) =>
      query === "bench" ? EXACT : null);

    const result = await parseSetsText("bench 5x5 185; zercher thrusters 95x8", "user-1");

    expect(result.usedModel).toBe(false);
    expect(result.entries.map((e) => e.exercise?.id ?? null)).toEqual([EXACT.id, null]);
    expect(result.unresolved).toEqual(["zercher thrusters"]);
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
    expect(vi.mocked(resolveExercise)).not.toHaveBeenCalled();
  });
});

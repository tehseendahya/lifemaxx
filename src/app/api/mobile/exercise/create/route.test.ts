import { describe, it, expect, beforeEach, vi } from "vitest";
import type { CreatedExercise, ResolvedExercise } from "@/lib/exercises";

/**
 * `POST /api/mobile/exercise/create` — which of the four answers the phone
 * gets, and why.
 *
 * Resolution and creation are mocked, because they have their own tests
 * against a real Postgres (`src/lib/exercises.db.test.ts`) and repeating them
 * here would test the database twice and this route not at all. What is
 * genuinely under test is the branching: an exact match is "you already have
 * this", a FUZZY match is demoted to a question rather than treated as the
 * same thing, `force` overrides both, and nothing is created from text that
 * holds no letter.
 *
 * The fuzzy demotion is the case worth having a test for. Everywhere else in
 * the app a fuzzy match is good enough to act on; here it is not, because
 * reaching this route means the user already looked at what matched and
 * pressed add anyway. If that branch ever collapses back into `exists`, the
 * screen built to fix the "confident wrong match with no way to override it"
 * complaint starts reproducing it.
 */

let currentUser: string | null = "user-1";

vi.mock("@/lib/supabase/server", () => ({
  currentUserId: async () => currentUser,
}));

vi.mock("@/db", () => ({
  withUser: <T>(_userId: string, fn: () => Promise<T>): Promise<T> => fn(),
}));

vi.mock("@/lib/queries", () => ({
  getProfile: async () => ({ tz: "America/New_York" }),
  localDate: () => "2026-10-25",
}));

vi.mock("@/lib/exercises", async () => {
  const actual = await vi.importActual<typeof import("@/lib/exercises")>("@/lib/exercises");
  return {
    MAX_EXERCISE_NAME: actual.MAX_EXERCISE_NAME,
    resolveExerciseOutcome: vi.fn(),
    createUserExercise: vi.fn(),
    musclesFor: vi.fn(),
  };
});

const { POST } = await import("./route");
const { resolveExerciseOutcome, createUserExercise, musclesFor, MAX_EXERCISE_NAME } =
  await import("@/lib/exercises");

/** 20 kg, so the lb at the edge is a conversion and not a copied number. */
const PREACHER: ResolvedExercise = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Preacher Curl",
  slug: "preacher-curl",
  incrementKg: 20,
  equipment: "barbell",
  confidence: "exact",
};

const CREATED: CreatedExercise = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Zorbax Thruster",
  slug: "zorbax-thruster",
  incrementKg: 20,
  equipment: "machine",
  confidence: "exact",
  muscles: [{ muscle: "chest", contribution: 1 }],
  musclesInferred: true,
};

function post(body: unknown): Request {
  return new Request("http://localhost/api/mobile/exercise/create", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  currentUser = "user-1";
  vi.mocked(resolveExerciseOutcome).mockReset();
  vi.mocked(createUserExercise).mockReset();
  vi.mocked(musclesFor).mockReset();
  vi.mocked(musclesFor).mockResolvedValue(
    new Map([[PREACHER.id, [{ muscle: "bicep" as const, contribution: 1 }]]]),
  );
});

describe("refusals", () => {
  it("401s when nobody is signed in, before resolving anything", async () => {
    currentUser = null;
    const res = await POST(post({ name: "preacher curls" }));
    expect(res.status).toBe(401);
    expect(resolveExerciseOutcome).not.toHaveBeenCalled();
  });

  it("refuses a missing or blank name", async () => {
    for (const body of [{}, { name: "" }, { name: "   " }]) {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
    }
    expect(resolveExerciseOutcome).not.toHaveBeenCalled();
  });

  it("refuses a name longer than the column allows", async () => {
    const res = await POST(post({ name: "z".repeat(MAX_EXERCISE_NAME + 1) }));
    expect(res.status).toBe(400);
    expect(resolveExerciseOutcome).not.toHaveBeenCalled();
  });

  it("refuses a mis-parsed set, including the ones that contain an x", async () => {
    // "225x5" reaching here means the parser split a line wrongly — and it is
    // the documented shape that does, since the parser needs a name before the
    // first number. A guard of "contains a letter" would pass every one of
    // these, because x is a letter, and create rows named "225x5" and
    // "100lb X 8".
    for (const name of [
      "225x5", "3x10", "5x5", "225 x 5", "8 x 8", "100lb x 8",
      "45", "-- 12 --", "2x", "12.5 kg", "3 × 10",
    ]) {
      const res = await POST(post({ name }));
      expect(res.status, name).toBe(400);
    }
    expect(createUserExercise).not.toHaveBeenCalled();
  });

  it("still accepts real lifts whose names carry numbers or an x", async () => {
    // The guard must not overreach: these are all things people actually lift.
    vi.mocked(resolveExerciseOutcome).mockResolvedValue({ kind: "new" });
    vi.mocked(createUserExercise).mockResolvedValue(CREATED);

    for (const name of [
      "21s", "5x5 bench", "Hex Bar Deadlift", "T-Bar Row", "V-Squat",
      "Zercher Squat", "JM Press", "incline smith press",
    ]) {
      const res = await POST(post({ name }));
      expect(res.status, name).toBe(200);
    }
  });
});

describe("it already exists", () => {
  it("returns the row for an EXACT match instead of creating a second one", async () => {
    vi.mocked(resolveExerciseOutcome).mockResolvedValue({ kind: "match", exercise: PREACHER });

    const body = await json(await POST(post({ name: "preacher curls" })));

    expect(body.created).toBe(false);
    expect(body.reason).toBe("exists");
    expect((body.exercise as Record<string, unknown>).slug).toBe("preacher-curl");
    expect(createUserExercise).not.toHaveBeenCalled();
  });

  it("converts the increment to lb at the edge", async () => {
    vi.mocked(resolveExerciseOutcome).mockResolvedValue({ kind: "match", exercise: PREACHER });
    const body = await json(await POST(post({ name: "preacher curls" })));
    // 20 kg, and storage stays kg — only the wire is lb.
    expect((body.exercise as Record<string, unknown>).incrementLb).toBeCloseTo(44.1, 1);
  });
});

describe("it might be something you already have", () => {
  it("demotes a FUZZY match to a question rather than claiming it exists", async () => {
    // "gronk preacher curl" fuzzy-matches the catalogue's Preacher Curl. The
    // user has already rejected the near things by pressing add, so answering
    // "exists" would answer a question they did not ask.
    vi.mocked(resolveExerciseOutcome).mockResolvedValue({
      kind: "match",
      exercise: { ...PREACHER, confidence: "fuzzy" },
    });

    const body = await json(await POST(post({ name: "gronk preacher curl" })));

    expect(body.created).toBe(false);
    expect(body.reason).toBe("near_miss");
    expect((body.suggestion as Record<string, unknown>).slug).toBe("preacher-curl");
    // Above the band, so a score here would be read as one and mislead.
    expect(body.score).toBeNull();
    expect(createUserExercise).not.toHaveBeenCalled();
  });

  it("asks about a near miss, and reports the score rounded", async () => {
    vi.mocked(resolveExerciseOutcome).mockResolvedValue({
      kind: "near_miss",
      candidate: { ...PREACHER, confidence: "none" },
      score: 0.4166666,
    });

    const body = await json(await POST(post({ name: "preachr curl" })));

    expect(body.reason).toBe("near_miss");
    expect(body.score).toBe(0.42);
    expect(createUserExercise).not.toHaveBeenCalled();
  });

  it("creates anyway once the user has answered with force", async () => {
    vi.mocked(createUserExercise).mockResolvedValue(CREATED);

    for (const outcome of [
      { kind: "match" as const, exercise: { ...PREACHER, confidence: "fuzzy" as const } },
      { kind: "near_miss" as const, candidate: PREACHER, score: 0.42 },
    ]) {
      vi.mocked(resolveExerciseOutcome).mockResolvedValue(outcome);
      const body = await json(await POST(post({ name: "zorbax thruster", force: true })));
      expect(body.created, outcome.kind).toBe(true);
      expect((body.exercise as Record<string, unknown>).slug).toBe("zorbax-thruster");
    }
  });

  it("does not let force fabricate a lift out of a mis-parsed set", async () => {
    for (const name of ["225x5", "45", "3 × 10"]) {
      const res = await POST(post({ name, force: true }));
      expect(res.status, name).toBe(400);
    }
    expect(createUserExercise).not.toHaveBeenCalled();
  });
});

describe("it is new", () => {
  it("creates it with no question asked", async () => {
    vi.mocked(resolveExerciseOutcome).mockResolvedValue({ kind: "new" });
    vi.mocked(createUserExercise).mockResolvedValue(CREATED);

    const body = await json(await POST(post({ name: "zorbax thruster" })));

    expect(body.created).toBe(true);
    expect((body.exercise as Record<string, unknown>).slug).toBe("zorbax-thruster");
    expect((body.exercise as Record<string, unknown>).incrementLb).toBeCloseTo(44.1, 1);
  });

  it("passes musclesInferred through, because the consequence is invisible", async () => {
    // getMuscleVolume INNER JOINs exercise_muscles, so an unmapped exercise
    // counts in history and zero toward the muscle-debt ranking. The client
    // can only say so if this flag survives the trip.
    vi.mocked(resolveExerciseOutcome).mockResolvedValue({ kind: "new" });
    vi.mocked(createUserExercise).mockResolvedValue({
      ...CREATED,
      muscles: [],
      musclesInferred: false,
    });

    const body = await json(await POST(post({ name: "quibblewomp hoist" })));

    expect(body.created).toBe(true);
    expect(body.musclesInferred).toBe(false);
  });

  it("trims what it was given before resolving it", async () => {
    vi.mocked(resolveExerciseOutcome).mockResolvedValue({ kind: "new" });
    vi.mocked(createUserExercise).mockResolvedValue(CREATED);

    await POST(post({ name: "  zorbax thruster  " }));

    expect(resolveExerciseOutcome).toHaveBeenCalledWith("zorbax thruster", "user-1");
    expect(createUserExercise).toHaveBeenCalledWith("zorbax thruster", "user-1");
  });
});

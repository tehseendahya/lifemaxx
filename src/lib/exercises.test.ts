import { describe, it, expect, vi } from "vitest";

/**
 * The pure half of exercise creation: what a typed phrase becomes.
 *
 * `@/db` is mocked because it opens a Postgres connection at module scope —
 * `adminDb = drizzle(connection())` runs on import and throws without a
 * DATABASE_URL. Nothing in this file touches the database; the queries,
 * row-level security and slug collisions are proved against a real Postgres in
 * `exercises.db.test.ts`.
 */
vi.mock("@/db", () => ({
  db: {},
  adminDb: {},
  withUser: async (_userId: string, fn: () => Promise<unknown>) => fn(),
}));

const {
  CUSTOM_SLUG_SUFFIX,
  FUZZY_MATCH_SCORE,
  NEAR_MISS_SCORE,
  MAX_EXERCISE_NAME,
  canonicalExerciseName,
  customSlugCandidates,
  inferEquipment,
  inferMuscles,
  inferUnilateral,
  slugify,
} = await import("./exercises");

const { CATALOGUE } = await import("@/db/catalogue");
const { MUSCLES } = await import("@/db/schema");

describe("resolution thresholds", () => {
  /*
   * The band has to be a band. If these two ever meet, the near-miss outcome
   * silently stops existing and every typo below the match bar becomes a
   * duplicate exercise — with no test failing anywhere else to say so.
   */
  it("leaves room between 'ask' and 'match'", () => {
    expect(NEAR_MISS_SCORE).toBeGreaterThan(0);
    expect(NEAR_MISS_SCORE).toBeLessThan(FUZZY_MATCH_SCORE);
    expect(FUZZY_MATCH_SCORE).toBeLessThan(1);
  });

  /**
   * The existing fuzzy bar is load-bearing elsewhere: `scripts/verify-db.ts`
   * asserts that "benh pres" resolves to barbell-bench-press, and that pair
   * scores 0.467. Raising this constant above that is a decision, not a
   * tidy-up, and it breaks that check.
   */
  it("keeps the fuzzy bar below the measured 'benh pres' score", () => {
    expect(FUZZY_MATCH_SCORE).toBeLessThan(0.467);
  });
});

describe("canonicalExerciseName", () => {
  it("title-cases and singularises what the owner typed", () => {
    expect(canonicalExerciseName("preacher curls")).toBe("Preacher Curl");
    expect(canonicalExerciseName("  incline SMITH press ")).toBe("Incline Smith Press");
    expect(canonicalExerciseName("pec deck")).toBe("Pec Deck");
    expect(canonicalExerciseName("cable rope hammer curls")).toBe("Cable Rope Hammer Curl");
  });

  it("leaves endings alone that singularising would mangle", () => {
    // "press" -> "pres" and "crunches" -> "crunche" are the two that matter.
    expect(canonicalExerciseName("chest press")).toBe("Chest Press");
    expect(canonicalExerciseName("cable crunches")).toBe("Cable Crunches");
    expect(canonicalExerciseName("abs")).toBe("Abs");
  });

  it("keeps initialisms as initialisms and hyphens as hyphens", () => {
    expect(canonicalExerciseName("db hammer curls")).toBe("DB Hammer Curl");
    expect(canonicalExerciseName("ez bar preacher curl")).toBe("EZ Bar Preacher Curl");
    expect(canonicalExerciseName("weighted pull-ups")).toBe("Weighted Pull-Up");
  });

  it("returns nothing for text that is not a name", () => {
    expect(canonicalExerciseName("")).toBe("");
    expect(canonicalExerciseName("   ")).toBe("");
    expect(canonicalExerciseName("!!! ??? ***")).toBe("");
  });

  it("caps the length", () => {
    expect(canonicalExerciseName("a".repeat(200)).length).toBeLessThanOrEqual(MAX_EXERCISE_NAME);
  });
});

describe("slug generation", () => {
  it("offers the plain name first, then numbered fallbacks", () => {
    const candidates = customSlugCandidates("Preacher Curl");
    expect(candidates[0]).toBe("preacher-curl-custom");
    expect(candidates[1]).toBe("preacher-curl-custom-2");
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("always produces a usable slug, even from a name of punctuation", () => {
    expect(slugify("Pec Deck!! (machine)")).toBe("pec-deck-machine");
    expect(customSlugCandidates("———")[0]).toBe(`exercise-${CUSTOM_SLUG_SUFFIX}`);
  });

  /*
   * THE COLLISION INVARIANT.
   *
   * The unique index is (slug, user_id) and Postgres treats NULLs as distinct,
   * so a custom "preacher-curl" and a catalogue "preacher-curl" would both be
   * accepted — leaving the user with one name twice and their history split
   * across the two rows. Reserving a suffix makes that impossible by
   * construction rather than by timing, which is the only way it can hold
   * while somebody else is adding 115 catalogue entries in parallel.
   */
  it("can never collide with a catalogue slug", () => {
    const catalogueSlugs = new Set(CATALOGUE.map((e) => e.slug));
    expect(catalogueSlugs.size).toBe(CATALOGUE.length);

    const offenders = CATALOGUE.filter((e) => e.slug.endsWith(`-${CUSTOM_SLUG_SUFFIX}`));
    expect(offenders.map((e) => e.slug)).toEqual([]);

    for (const entry of CATALOGUE) {
      expect(customSlugCandidates(entry.name)).not.toContain(entry.slug);
    }
  });
});

describe("inferEquipment", () => {
  it("reads the equipment the name states", () => {
    expect(inferEquipment("Incline Smith Press")).toBe("machine");
    expect(inferEquipment("Pec Deck")).toBe("machine");
    expect(inferEquipment("Cable Rope Hammer Curl")).toBe("cable");
    expect(inferEquipment("DB Hammer Curl")).toBe("dumbbell");
    expect(inferEquipment("EZ Bar Curl")).toBe("barbell");
    expect(inferEquipment("Weighted Pull-Up")).toBe("bodyweight");
  });

  it("says nothing rather than guessing barbell", () => {
    // The column's default is "barbell", which would print BARBELL under
    // "Preacher Curl" in the picker. The picker renders nothing for "".
    expect(inferEquipment("Preacher Curl")).toBe("");
    expect(inferEquipment("JM Press")).toBe("");
  });
});

describe("inferUnilateral", () => {
  it("only believes the name when it says so", () => {
    expect(inferUnilateral("Single Arm Cable Row")).toBe(true);
    expect(inferUnilateral("One Leg Press")).toBe(true);
    expect(inferUnilateral("Preacher Curl")).toBe(false);
    expect(inferUnilateral("Barbell Row")).toBe(false);
  });
});

describe("inferMuscles", () => {
  const map = (name: string) =>
    Object.fromEntries(inferMuscles(name).map((m) => [m.muscle, m.contribution]));

  it("maps the owner's five lines where the name is unambiguous", () => {
    expect(map("Preacher Curl")).toEqual({ bicep: 1, forearm: 0.5 });
    expect(map("Cable Rope Hammer Curl")).toEqual({ bicep: 1, forearm: 0.5 });
    expect(map("Pec Deck")).toEqual({ chest: 1 });
    expect(map("Incline Smith Press")).toEqual({ chest: 1, front_delt: 0.5, tricep: 0.5 });
  });

  it("reads the specific rule before the general one", () => {
    // "leg curl" is a hamstring lift and "curl" is a bicep lift; order decides.
    expect(map("Seated Leg Curl")).toEqual({ hamstring: 1 });
    expect(map("Nordic Hamstring Curl")).toEqual({ hamstring: 1 });
    expect(map("Reverse Wrist Curl")).toEqual({ forearm: 1 });
    expect(map("Spider Curl")).toEqual({ bicep: 1, forearm: 0.5 });

    expect(map("Bulgarian Split Squat")).toEqual({ quad: 1, glute: 1 });
    expect(map("Hack Squat")).toEqual({ quad: 1, glute: 0.5 });

    expect(map("Leg Press")).toEqual({ quad: 1, glute: 0.5 });
    expect(map("Machine Chest Press")).toEqual({ chest: 1, front_delt: 0.5, tricep: 0.5 });
    expect(map("Landmine Press")).toEqual({ front_delt: 1, side_delt: 0.5, tricep: 0.5 });
  });

  /*
   * The important half. A wrong mapping is invisible and it corrupts the
   * muscle-debt ranking the homepage, the coach and the picker's "owed this
   * week" block are all built on — so a name that does not say what it trains
   * gets nothing, and the create route tells the user so.
   */
  it("leaves a name that says nothing unmapped", () => {
    expect(inferMuscles("JM Press")).toEqual([]);
    expect(inferMuscles("Tate Press")).toEqual([]);
    expect(inferMuscles("Zorbax Thruster")).toEqual([]);
    expect(inferMuscles("The Machine In The Corner")).toEqual([]);
    expect(inferMuscles("")).toEqual([]);
  });

  it("only ever emits muscles the enum knows and contributions the maths expects", () => {
    const names = [
      ...CATALOGUE.map((e) => e.name),
      "Preacher Curl", "Pec Deck", "Incline Smith Press", "Seal Row", "Zercher Squat",
      "Cable Lateral Raise", "Reverse Hyper", "Hip Abduction", "Ab Wheel Rollout",
    ];
    const allowed = new Set<string>(MUSCLES);

    for (const name of names) {
      for (const m of inferMuscles(name)) {
        expect(allowed.has(m.muscle)).toBe(true);
        // 1.0 primary, 0.5 secondary — `hardSetsByMuscle` is built on those two.
        expect([0.5, 1]).toContain(m.contribution);
      }
    }
  });
});

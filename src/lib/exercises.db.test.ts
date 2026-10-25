import "../../load-env";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Exercise resolution and creation, against a real Postgres.
 *
 * Everything here needs the database itself and cannot be faked usefully:
 *
 *  - the three resolution outcomes are decided by `similarity()`, a pg_trgm
 *    function. A mocked score is a test of the mock.
 *  - the slug rule is enforced by a unique index on (slug, user_id), including
 *    the part where Postgres treats NULLs as distinct.
 *  - the ownership rule is enforced by the row-level security policies in
 *    drizzle/0001, not by any `where` clause in this codebase. A test that
 *    asserted isolation by reading a `userId` field would pass against a
 *    database with RLS switched off, which is the one failure that matters.
 *
 * Fixtures are deliberate nonsense ("zorbax thruster"). The catalogue is being
 * expanded from 35 entries to ~150 in parallel, and a fixture named "preacher
 * curl" would start resolving exactly the moment that lands — so the names
 * here are ones no catalogue will ever contain. Measured against the live alias
 * table, "quibblewomp hoist" scores 0.074 and "zorbax" scores 0.000 against
 * every catalogue alias, which is what keeps the thresholds under test rather
 * than the catalogue.
 *
 * Skipped, not failed, without a DATABASE_URL: the dynamic imports below never
 * run, so `@/db` never opens a connection.
 */

const A = "aaaaaaaa-0000-4000-8000-0000000000ea";
const B = "bbbbbbbb-0000-4000-8000-0000000000eb";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("exercises, against the database", () => {
  let lib: typeof import("./exercises");
  let dbm: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let orm: typeof import("drizzle-orm");

  beforeAll(async () => {
    lib = await import("./exercises");
    dbm = await import("@/db");
    schema = await import("@/db/schema");
    orm = await import("drizzle-orm");

    await cleanup();
    await dbm.adminDb.insert(schema.profiles).values([
      { id: A, email: "a@exercises.test" },
      { id: B, email: "b@exercises.test" },
    ]);
  });

  afterAll(async () => {
    await cleanup().catch(() => {});
  });

  async function cleanup() {
    if (!dbm) return;
    // profiles cascades to exercises, which cascades to aliases and muscles.
    await dbm.adminDb.delete(schema.profiles)
      .where(orm.inArray(schema.profiles.id, [A, B]));
  }

  // ------------------------------------------------------- the three outcomes

  describe("resolveExerciseOutcome", () => {
    beforeAll(async () => {
      await dbm.withUser(A, () => lib.createUserExercise("zorbax thruster", A));
    });

    it("returns an exact match for a wording it has seen", async () => {
      const outcome = await dbm.withUser(A, () =>
        lib.resolveExerciseOutcome("  ZORBAX   Thruster ", A));

      expect(outcome.kind).toBe("match");
      if (outcome.kind !== "match") return;
      expect(outcome.exercise.name).toBe("Zorbax Thruster");
      expect(outcome.exercise.confidence).toBe("exact");
    });

    it("returns a fuzzy match for a typo above the match bar", async () => {
      // similarity("zorbax thruster", "zorbax thrustr") = 0.722.
      const outcome = await dbm.withUser(A, () =>
        lib.resolveExerciseOutcome("zorbax thrustr", A));

      expect(outcome.kind).toBe("match");
      if (outcome.kind !== "match") return;
      expect(outcome.exercise.name).toBe("Zorbax Thruster");
      expect(outcome.exercise.confidence).toBe("fuzzy");
    });

    it("returns a near miss inside the band, naming what it might have meant", async () => {
      // similarity("zorbax thruster", "zorbax") = 0.438 — under the match bar,
      // over the ask bar. This is the outcome that did not exist before: it is
      // what stops "bnch pres" quietly becoming a second bench press.
      const outcome = await dbm.withUser(A, () =>
        lib.resolveExerciseOutcome("zorbax", A));

      expect(outcome.kind).toBe("near_miss");
      if (outcome.kind !== "near_miss") return;
      expect(outcome.candidate.name).toBe("Zorbax Thruster");
      expect(outcome.score).toBeGreaterThanOrEqual(lib.NEAR_MISS_SCORE);
      expect(outcome.score).toBeLessThanOrEqual(lib.FUZZY_MATCH_SCORE);
    });

    it("returns 'new' when nothing resembles the text", async () => {
      const outcome = await dbm.withUser(A, () =>
        lib.resolveExerciseOutcome("quibblewomp hoist", A));

      expect(outcome).toEqual({ kind: "new" });
    });

    it("refuses to treat empty text as anything", async () => {
      const outcome = await dbm.withUser(A, () => lib.resolveExerciseOutcome("   ", A));
      expect(outcome).toEqual({ kind: "blank" });
    });

    it("hides a near miss from the yes/no caller rather than guessing for it", async () => {
      // `parseSetsText` has no way to ask a question, so a near miss must reach
      // it as unresolved. Returning the candidate would file a set against a
      // lift the user never did.
      const resolved = await dbm.withUser(A, () => lib.resolveExercise("zorbax", A));
      expect(resolved).toBeNull();
    });
  });

  // ------------------------------------------------------------ alias learning

  describe("creating an exercise", () => {
    it("learns both the typed wording and the canonical name", async () => {
      const created = await dbm.withUser(A, () =>
        lib.createUserExercise("flandangle vaults", A));

      expect(created.name).toBe("Flandangle Vault");

      // The wording the user actually typed — the whole point, since this is
      // what they will type again.
      const typed = await dbm.withUser(A, () =>
        lib.resolveExerciseOutcome("flandangle vaults", A));
      expect(typed.kind === "match" && typed.exercise.id).toBe(created.id);
      expect(typed.kind === "match" && typed.exercise.confidence).toBe("exact");

      // And the name as the app now spells it, so typing that back is free too.
      const canonical = await dbm.withUser(A, () =>
        lib.resolveExerciseOutcome("Flandangle Vault", A));
      expect(canonical.kind === "match" && canonical.exercise.id).toBe(created.id);
      expect(canonical.kind === "match" && canonical.exercise.confidence).toBe("exact");
    });

    it("repoints an alias the user corrects a second time", async () => {
      const first = await dbm.withUser(A, () => lib.createUserExercise("grumbo lift", A));
      const second = await dbm.withUser(A, () => lib.createUserExercise("snorlax hoist", A));

      await dbm.withUser(A, () => lib.learnAlias(first.id, "the weird one", A));
      await dbm.withUser(A, () => lib.learnAlias(second.id, "the weird one", A));

      const outcome = await dbm.withUser(A, () =>
        lib.resolveExerciseOutcome("the weird one", A));
      expect(outcome.kind === "match" && outcome.exercise.id).toBe(second.id);
    });

    it("lets the user's correction beat the catalogue, under any query plan", async () => {
      // The fix-a-mismatch flow: "bench" is a global alias of the barbell
      // bench press, and the user re-points it at something of their own.
      // Tier 1 matches BOTH rows, so without an ORDER BY the winner is decided
      // by the plan. Measured before the fix: the user's row won 20/20 with the
      // alias index in play, and lost 10/10 with enable_indexscan off — a plan
      // Postgres will choose on its own as statistics change. The symptom is a
      // correction that sticks, then silently reverts.
      //
      // Both plans are exercised here rather than trusting the planner to pick
      // the one that happens to pass.
      const mine = await dbm.withUser(A, () => lib.createUserExercise("zorbax thruster v2", A));
      await dbm.withUser(A, () => lib.learnAlias(mine.id, "bench", A));

      const global = await dbm.adminDb.select({ id: schema.exerciseAliases.id })
        .from(schema.exerciseAliases)
        .where(orm.and(
          orm.eq(schema.exerciseAliases.alias, "bench"),
          orm.isNull(schema.exerciseAliases.userId),
        ));
      // Guard the premise: without a global "bench" there is nothing to beat.
      expect(global.length).toBe(1);

      for (const indexScans of ["on", "off"] as const) {
        await dbm.adminDb.execute(orm.sql`set enable_indexscan = ${orm.sql.raw(indexScans)}`);
        await dbm.adminDb.execute(orm.sql`set enable_bitmapscan = ${orm.sql.raw(indexScans)}`);
        const outcome = await dbm.withUser(A, () => lib.resolveExerciseOutcome("bench", A));
        expect(outcome.kind === "match" && outcome.exercise.id, `enable_indexscan=${indexScans}`)
          .toBe(mine.id);
      }
      await dbm.adminDb.execute(orm.sql`set enable_indexscan = on`);
      await dbm.adminDb.execute(orm.sql`set enable_bitmapscan = on`);

      // Another user is unaffected: they still get the catalogue lift.
      const theirs = await dbm.withUser(B, () => lib.resolveExerciseOutcome("bench", B));
      expect(theirs.kind === "match" && theirs.exercise.slug).toBe("barbell-bench-press");
    });

    it("stores it in lb-friendly kg and owns it by user, never by the catalogue", async () => {
      const created = await dbm.withUser(A, () => lib.createUserExercise("blorp press", A));

      const [stored] = await dbm.adminDb.select()
        .from(schema.exercises)
        .where(orm.eq(schema.exercises.id, created.id));

      expect(stored.userId).toBe(A);
      // displayLb() must render exactly "5", not "5.5" — the column default of
      // 2.5 kg would have put 5.5 lb on every custom exercise's stepper.
      const { displayLb } = await import("@/lib/domain/units");
      expect(displayLb(stored.incrementKg)).toBe(lib.DEFAULT_INCREMENT_LB);
    });

    it("maps muscles only where the name says so", async () => {
      const mapped = await dbm.withUser(A, () => lib.createUserExercise("glimmer preacher curl", A));
      expect(mapped.musclesInferred).toBe(true);
      const rows = await dbm.withUser(A, () => lib.musclesFor([mapped.id]));
      expect(rows.get(mapped.id)).toEqual(
        expect.arrayContaining([{ muscle: "bicep", contribution: 1 }]),
      );

      const unmapped = await dbm.withUser(A, () => lib.createUserExercise("wobbleflex hoister", A));
      expect(unmapped.musclesInferred).toBe(false);
      expect(unmapped.muscles).toEqual([]);
      const none = await dbm.withUser(A, () => lib.musclesFor([unmapped.id]));
      expect(none.get(unmapped.id)).toBeUndefined();
    });
  });

  // ------------------------------------------------------------ slug collision

  describe("slugs", () => {
    it("lets two users create the same exercise without colliding", async () => {
      const mine = await dbm.withUser(A, () => lib.createUserExercise("quibbly curl", A));
      const theirs = await dbm.withUser(B, () => lib.createUserExercise("quibbly curl", B));

      // Same slug, different owners — which is exactly what the unique index on
      // (slug, user_id) is for. One global slug namespace would have made the
      // second user's first custom exercise fail.
      expect(mine.slug).toBe(theirs.slug);
      expect(mine.slug).toBe(`quibbly-curl-${lib.CUSTOM_SLUG_SUFFIX}`);
      expect(mine.id).not.toBe(theirs.id);
    });

    it("numbers the slug when one user has two names that slugify alike", async () => {
      const first = await dbm.withUser(A, () => lib.createUserExercise("zonk-deck fly", A));
      const second = await dbm.withUser(A, () => lib.createUserExercise("zonk deck fly", A));

      expect(first.slug).toBe(`zonk-deck-fly-${lib.CUSTOM_SLUG_SUFFIX}`);
      expect(second.slug).toBe(`zonk-deck-fly-${lib.CUSTOM_SLUG_SUFFIX}-2`);
      expect(first.id).not.toBe(second.id);
    });

    it("never takes a slug the shared catalogue could later use", async () => {
      const created = await dbm.withUser(A, () => lib.createUserExercise("bench press zonk", A));
      const [catalogueRow] = await dbm.adminDb.select({ slug: schema.exercises.slug })
        .from(schema.exercises)
        .where(orm.and(
          orm.isNull(schema.exercises.userId),
          orm.eq(schema.exercises.slug, created.slug),
        ));

      expect(catalogueRow).toBeUndefined();
      expect(created.slug.endsWith(`-${lib.CUSTOM_SLUG_SUFFIX}`)).toBe(true);
    });
  });

  // --------------------------------------------------------- row-level security

  describe("row-level security", () => {
    it("hides one user's custom exercise from another", async () => {
      const mine = await dbm.withUser(A, () => lib.createUserExercise("wimble raise", A));

      const asOwner = await dbm.withUser(A, () => dbm.db.select()
        .from(schema.exercises)
        .where(orm.eq(schema.exercises.id, mine.id)));
      expect(asOwner).toHaveLength(1);

      // Postgres decides this, not a `where` clause. The id is known and
      // supplied; the policy is the only thing standing in the way.
      const asStranger = await dbm.withUser(B, () => dbm.db.select()
        .from(schema.exercises)
        .where(orm.eq(schema.exercises.id, mine.id)));
      expect(asStranger).toEqual([]);
    });

    it("hides the alias too, so the other user's resolution is unaffected", async () => {
      await dbm.withUser(A, () => lib.createUserExercise("flibbertigibbet row", A));

      const owner = await dbm.withUser(A, () =>
        lib.resolveExerciseOutcome("flibbertigibbet row", A));
      expect(owner.kind).toBe("match");

      // Not a match, and not a near miss either: B cannot see the row or the
      // alias, so for B this phrase is simply a new exercise.
      const stranger = await dbm.withUser(B, () =>
        lib.resolveExerciseOutcome("flibbertigibbet row", B));
      expect(stranger.kind).toBe("new");
    });

    it("will not let a request write into the shared catalogue", async () => {
      // user_id NULL is the catalogue: readable by everyone, writable by
      // nobody. `write_own_exercises` has WITH CHECK (user_id =
      // app.current_user_id()), so this must be refused rather than quietly
      // adding a lift to every other user's app.
      await expect(
        dbm.withUser(A, () => dbm.db.insert(schema.exercises).values({
          userId: null,
          name: "Sneaky Catalogue Row",
          slug: "sneaky-catalogue-row",
        })),
      ).rejects.toThrow();
    });
  });
});

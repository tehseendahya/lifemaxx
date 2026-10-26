import "../../load-env";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

/**
 * Per-exercise carry-forward cues, against a real Postgres.
 *
 * Everything here needs the database itself, for the same reason
 * `exercises.db.test.ts` does:
 *
 *  - the ONE-CUE-PER-LIFT rule is a composite primary key, and "saving twice
 *    replaces" is `ON CONFLICT` behaviour on that key. Asserting it against a
 *    fake would be asserting the fake replaces things.
 *  - "an empty cue cannot be stored" is a CHECK constraint. Code that trims
 *    before writing is a convention; the constraint is the guarantee, and the
 *    test that matters is the one that goes around the convention.
 *  - the OWNERSHIP rule is the RLS policy in drizzle/0005, not a `where`
 *    clause anywhere in this codebase. A test that proved isolation by reading
 *    back a `userId` field would pass against a database with RLS switched
 *    off, which is the one failure worth catching.
 *  - the WRITE-VISIBILITY rule — you cannot pin a cue to a lift you cannot see
 *    — lives only in that policy's WITH CHECK. There is no equivalent in
 *    `setCue()` at all; the route's 404 is cosmetic, and the database is what
 *    actually refuses.
 *
 * Fixtures are deliberate nonsense ("wimbleflop press") so no catalogue
 * expansion can make one of them resolve to something real.
 *
 * Skipped, not failed, without a DATABASE_URL: the dynamic imports below never
 * run, so `@/db` never opens a connection.
 */

const A = "aaaaaaaa-0000-4000-8000-0000000000ca";
const B = "bbbbbbbb-0000-4000-8000-0000000000cb";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("exercise cues, against the database", () => {
  let lib: typeof import("./cues");
  let exerciseLib: typeof import("./exercises");
  let dbm: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let orm: typeof import("drizzle-orm");

  /** A's own custom lift, and a catalogue lift both users can see. */
  let mine: string;
  let theirs: string;
  let catalogue: string;

  beforeAll(async () => {
    lib = await import("./cues");
    exerciseLib = await import("./exercises");
    dbm = await import("@/db");
    schema = await import("@/db/schema");
    orm = await import("drizzle-orm");

    await cleanup();
    await dbm.adminDb.insert(schema.profiles).values([
      { id: A, email: "a@cues.test" },
      { id: B, email: "b@cues.test" },
    ]);

    mine = (await dbm.withUser(A, () => exerciseLib.createUserExercise("wimbleflop press", A))).id;
    theirs = (await dbm.withUser(B, () => exerciseLib.createUserExercise("snorgle row", B))).id;

    // The reason this table exists: the lift a cue is actually wanted on is a
    // catalogue row, shared by every account and unwritable from a request.
    const [row] = await dbm.adminDb.select({ id: schema.exercises.id })
      .from(schema.exercises)
      .where(orm.and(
        orm.isNull(schema.exercises.userId),
        orm.eq(schema.exercises.slug, "barbell-bench-press"),
      ));
    // Guard the premise: without the catalogue row there is nothing to prove.
    expect(row?.id).toBeTruthy();
    catalogue = row.id;
  });

  afterAll(async () => {
    await cleanup().catch(() => {});
  });

  beforeEach(async () => {
    // Cues only; the profiles and exercises are shared across the file.
    await dbm.adminDb.delete(schema.exerciseCues)
      .where(orm.inArray(schema.exerciseCues.userId, [A, B]));
  });

  async function cleanup() {
    if (!dbm) return;
    // profiles cascades to exercises and to exercise_cues.
    await dbm.adminDb.delete(schema.profiles)
      .where(orm.inArray(schema.profiles.id, [A, B]));
  }

  // --------------------------------------------------------- write then read

  describe("writing a cue", () => {
    it("pins it to a CATALOGUE lift, which is the whole point of the table", async () => {
      // `exercises.user_id IS NULL` is the shared catalogue: readable by
      // everyone, writable by nobody. A `cue` column there would have been
      // unwritable for 146 of the owner's 147 exercises, including the bench
      // press — so this is the case the design exists for.
      const stored = await dbm.withUser(A, () =>
        lib.setCue(A, catalogue, "Elbows tucked, pause on chest"));

      expect(stored).toBe("Elbows tucked, pause on chest");
      expect(await dbm.withUser(A, () => lib.getCue(A, catalogue)))
        .toBe("Elbows tucked, pause on chest");
    });

    it("comes back in the map the bootstrap payload sends", async () => {
      await dbm.withUser(A, () => lib.setCue(A, catalogue, "Pause on chest"));
      await dbm.withUser(A, () => lib.setCue(A, mine, "Slow eccentric"));

      const cues = await dbm.withUser(A, () => lib.getCues(A));
      expect(cues).toEqual({ [catalogue]: "Pause on chest", [mine]: "Slow eccentric" });
    });

    it("omits a lift with no cue rather than sending an empty string", async () => {
      await dbm.withUser(A, () => lib.setCue(A, mine, "Slow eccentric"));

      const cues = await dbm.withUser(A, () => lib.getCues(A));
      // `cues[id] === undefined` has to be the single answer to "is there a
      // cue here", or every consumer needs to know that "" means the same
      // thing for a different reason.
      expect(catalogue in cues).toBe(false);
      expect(await dbm.withUser(A, () => lib.getCue(A, catalogue))).toBeNull();
    });

    it("replaces rather than duplicating when the same lift is saved twice", async () => {
      await dbm.withUser(A, () => lib.setCue(A, mine, "First thought"));
      const second = await dbm.withUser(A, () => lib.setCue(A, mine, "Second thought"));

      expect(second).toBe("Second thought");

      // One row, not two. The composite primary key is what guarantees it, so
      // the count is read with the admin handle rather than inferred from the
      // helper that just wrote it.
      const rows = await dbm.adminDb.select()
        .from(schema.exerciseCues)
        .where(orm.and(
          orm.eq(schema.exerciseCues.userId, A),
          orm.eq(schema.exerciseCues.exerciseId, mine),
        ));
      expect(rows).toHaveLength(1);
      expect(rows[0].cue).toBe("Second thought");
    });

    it("keeps one user's cue for a lift separate from the other's", async () => {
      // Same catalogue exercise, two accounts. A cue column on `exercises`
      // would have made these one value; the (user, exercise) key makes them
      // two by construction.
      await dbm.withUser(A, () => lib.setCue(A, catalogue, "Pause on chest"));
      await dbm.withUser(B, () => lib.setCue(B, catalogue, "Touch and go"));

      expect(await dbm.withUser(A, () => lib.getCue(A, catalogue))).toBe("Pause on chest");
      expect(await dbm.withUser(B, () => lib.getCue(B, catalogue))).toBe("Touch and go");
    });
  });

  // ------------------------------------------------------------- normalisation

  describe("normalisation", () => {
    it("trims the ends but keeps the line breaks the owner typed", async () => {
      // Line breaks are the only formatting this field has — "elbows tucked"
      // above "pause on chest" is two cues on one lift, and collapsing them
      // into a run-on line would throw that away.
      const stored = await dbm.withUser(A, () =>
        lib.setCue(A, mine, "  Elbows tucked\nPause on chest  \n\n\n\nBreathe  "));

      expect(stored).toBe("Elbows tucked\nPause on chest\n\nBreathe");
    });

    it("stores whitespace-only text as no cue at all", async () => {
      await dbm.withUser(A, () => lib.setCue(A, mine, "Slow eccentric"));

      const cleared = await dbm.withUser(A, () => lib.setCue(A, mine, "   \n\t  "));
      expect(cleared).toBeNull();

      // Cleared means the row is gone, not blank.
      const rows = await dbm.adminDb.select()
        .from(schema.exerciseCues)
        .where(orm.eq(schema.exerciseCues.userId, A));
      expect(rows).toEqual([]);
    });

    it("clearing a cue that was never there is not an error", async () => {
      // The route sends whatever is in the text field, so this is an ordinary
      // request rather than a corner case.
      expect(await dbm.withUser(A, () => lib.setCue(A, mine, ""))).toBeNull();
    });

    it("refuses a cue past the ceiling instead of truncating it", async () => {
      // Silently cutting it would hand back a cue missing its last word with
      // no indication of why.
      const tooLong = "x".repeat(lib.MAX_CUE_LENGTH + 1);
      await expect(dbm.withUser(A, () => lib.setCue(A, mine, tooLong))).rejects.toThrow();

      const atLimit = "y".repeat(lib.MAX_CUE_LENGTH);
      expect(await dbm.withUser(A, () => lib.setCue(A, mine, atLimit))).toBe(atLimit);
    });
  });

  // --------------------------------------------------------- the CHECK itself

  describe("the shape constraint", () => {
    it("refuses an empty cue even when `setCue` is bypassed", async () => {
      // Postgres decides this, not `normaliseCue`. Two representations of "no
      // cue" is the thing being prevented, and a convention in one function
      // does not prevent it — the next caller writes `''` and every client
      // renders an empty grey box.
      await expect(
        dbm.adminDb.insert(schema.exerciseCues).values({ userId: A, exerciseId: mine, cue: "" }),
      ).rejects.toThrow();
    });

    it("refuses an untrimmed cue even when `setCue` is bypassed", async () => {
      await expect(
        dbm.adminDb.insert(schema.exerciseCues)
          .values({ userId: A, exerciseId: mine, cue: "  padded  " }),
      ).rejects.toThrow();
    });

    it("refuses an over-long cue even when `setCue` is bypassed", async () => {
      await expect(
        dbm.adminDb.insert(schema.exerciseCues)
          .values({ userId: A, exerciseId: mine, cue: "z".repeat(lib.MAX_CUE_LENGTH + 1) }),
      ).rejects.toThrow();
    });
  });

  // --------------------------------------------------------------- lifecycle

  describe("lifecycle", () => {
    it("goes away with the exercise it was pinned to", async () => {
      const doomed = await dbm.withUser(A, () =>
        exerciseLib.createUserExercise("flibberty hoist", A));
      await dbm.withUser(A, () => lib.setCue(A, doomed.id, "Keep it tight"));

      await dbm.withUser(A, () => dbm.db.delete(schema.exercises)
        .where(orm.eq(schema.exercises.id, doomed.id)));

      // ON DELETE CASCADE, so no orphan is left to be read back against a row
      // that no longer exists.
      const rows = await dbm.adminDb.select()
        .from(schema.exerciseCues)
        .where(orm.eq(schema.exerciseCues.exerciseId, doomed.id));
      expect(rows).toEqual([]);
    });
  });

  // --------------------------------------------------------- row-level security

  describe("row-level security", () => {
    it("hides one user's cue from the other, on a lift they both have", async () => {
      await dbm.withUser(A, () => lib.setCue(A, catalogue, "Pause on chest"));

      expect(await dbm.withUser(A, () => lib.getCue(A, catalogue))).toBe("Pause on chest");

      // The exercise id is known and shared — it is a catalogue row B can see
      // perfectly well. The policy is the only thing standing between B and
      // A's cue for it.
      expect(await dbm.withUser(B, () => lib.getCue(B, catalogue))).toBeNull();
      expect(await dbm.withUser(B, () => lib.getCues(B))).toEqual({});
    });

    it("hides it from a SELECT that asks for it by user id directly", async () => {
      await dbm.withUser(A, () => lib.setCue(A, catalogue, "Pause on chest"));

      // Guard the premise, so an empty result cannot mean "nothing was ever
      // written". The admin handle bypasses RLS and must see the row.
      const asAdmin = await dbm.adminDb.select()
        .from(schema.exerciseCues)
        .where(orm.eq(schema.exerciseCues.userId, A));
      expect(asAdmin).toHaveLength(1);

      // Not `getCues(B)`, which filters by user_id itself and would pass
      // against a database with RLS switched off. This asks Postgres, as B,
      // for A's rows by name — the same row the line above just proved is
      // there. The policy is the only difference between the two answers.
      const asStranger = await dbm.withUser(B, () => dbm.db.select()
        .from(schema.exerciseCues)
        .where(orm.eq(schema.exerciseCues.userId, A)));
      expect(asStranger).toEqual([]);
    });

    it("will not let one user write a cue under another user's id", async () => {
      await expect(
        dbm.withUser(B, () => dbm.db.insert(schema.exerciseCues)
          .values({ userId: A, exerciseId: catalogue, cue: "Not mine to write" })),
      ).rejects.toThrow();
    });

    it("will not let one user overwrite the other's cue on the same lift", async () => {
      await dbm.withUser(A, () => lib.setCue(A, catalogue, "Pause on chest"));

      // B's write is its own row, not an overwrite — the key is
      // (user_id, exercise_id). A's cue has to survive it untouched.
      await dbm.withUser(B, () => lib.setCue(B, catalogue, "Touch and go"));
      expect(await dbm.withUser(A, () => lib.getCue(A, catalogue))).toBe("Pause on chest");

      // And B deleting its own cue cannot take A's with it, which is what an
      // UPDATE/DELETE policy scoped only by exercise_id would have allowed.
      await dbm.withUser(B, () => lib.setCue(B, catalogue, ""));
      expect(await dbm.withUser(A, () => lib.getCue(A, catalogue))).toBe("Pause on chest");
    });

    it("will not let a user pin a cue to a lift they cannot see", async () => {
      // `theirs` is B's custom exercise. A has the id here only because this
      // test file created it; in the wild it would be a guessed uuid. The
      // WITH CHECK on `own_exercise_cues` requires the exercise to be visible
      // to the writer, so this is refused by Postgres — `setCue` has no such
      // check of its own, and the route's 404 is only a nicer error message.
      await expect(dbm.withUser(A, () => lib.setCue(A, theirs, "Prying"))).rejects.toThrow();

      const rows = await dbm.adminDb.select()
        .from(schema.exerciseCues)
        .where(orm.eq(schema.exerciseCues.exerciseId, theirs));
      expect(rows).toEqual([]);
    });
  });
});

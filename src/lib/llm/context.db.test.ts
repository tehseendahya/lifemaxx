import "../../../load-env";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * The DATA COVERAGE block, against a real Postgres.
 *
 * The prompt rules are tested without a database in `prompts.test.ts`, and
 * `coverageBlock` is a pure function tested as one. What neither of those can
 * prove is that the three numbers handed to it are the real ones — the counts
 * come from `getDailyHardSets`, `getWeighIns` and the intake loop, each over a
 * different window, and getting one of those wrong would make the coach caveat
 * confidently with a figure that is simply false. That is worse than the
 * refusal it replaced, so it gets a test against the database.
 *
 * The fixture is the owner's actual state on the day they complained: one lift
 * day, one weigh-in, one day of food. Every stream thin, which is the case the
 * rewrite exists for.
 *
 * Skipped, not failed, without a DATABASE_URL: the dynamic imports below never
 * run, so `@/db` never opens a connection.
 */

const USER = "cccccccc-0000-4000-8000-00000000c0de";
const TODAY = "2026-10-25";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("coach context coverage", () => {
  let ctx: typeof import("./context");
  let prompts: typeof import("./prompts");
  let dbm: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let orm: typeof import("drizzle-orm");
  let workoutId: string;

  beforeAll(async () => {
    ctx = await import("./context");
    prompts = await import("./prompts");
    dbm = await import("@/db");
    schema = await import("@/db/schema");
    orm = await import("drizzle-orm");

    await cleanup();
    await dbm.adminDb.insert(schema.profiles).values({
      id: USER,
      email: "coverage@context.test",
      goalsText: "205 bench press by December. Current split: chest, side delts, biceps.",
    });

    const [bench] = await dbm.adminDb.select({ id: schema.exercises.id })
      .from(schema.exercises)
      .where(orm.and(
        orm.isNull(schema.exercises.userId),
        orm.eq(schema.exercises.slug, "barbell-bench-press"),
      ));
    expect(bench?.id).toBeTruthy();

    await dbm.withUser(USER, async () => {
      // One lift day, yesterday. Two working sets, so "one lift day" cannot
      // pass by accident on a count of sets rather than of days.
      const [workout] = await dbm.db.insert(schema.workouts).values({
        userId: USER, localDate: "2026-10-24", status: "completed", name: "Push",
      }).returning({ id: schema.workouts.id });
      workoutId = workout.id;

      await dbm.db.insert(schema.sets).values([
        { workoutId: workout.id, exerciseId: bench.id, setIndex: 0, reps: 5, weightKg: 74.8, rpe: 8 },
        { workoutId: workout.id, exerciseId: bench.id, setIndex: 1, reps: 5, weightKg: 74.8, rpe: 9 },
      ]);

      // One day of food, two meals on it — same trap, the other way round.
      await dbm.db.insert(schema.meals).values([
        {
          userId: USER, localDate: "2026-10-24", slot: "lunch", source: "manual",
          kcal: 700, proteinG: 55, carbsG: 60, fatG: 24,
        },
        {
          userId: USER, localDate: "2026-10-24", slot: "dinner", source: "manual",
          kcal: 820, proteinG: 62, carbsG: 70, fatG: 30,
        },
      ]);

      // One weigh-in.
      await dbm.db.insert(schema.bodyMetrics).values({
        userId: USER, localDate: "2026-10-24", weightKg: 81.6,
      });
    });
  });

  afterAll(async () => { await cleanup().catch(() => {}); });

  async function cleanup() {
    if (!dbm) return;
    // profiles cascades to workouts, meals and body_metrics.
    await dbm.adminDb.delete(schema.profiles).where(orm.eq(schema.profiles.id, USER));
  }

  it("counts days, not rows, on every stream", async () => {
    const { prefix, coverage } = await dbm.withUser(USER, () =>
      ctx.buildCoachContext(USER, TODAY));

    expect(coverage).toEqual({
      windowDays: ctx.COVERAGE_WINDOW_DAYS,
      intakeDays: 1,
      liftDays: 1,
      weighIns: 1,
    });
    expect(prefix).toContain("food logged on 1 of the last 14 days (thin)");
    expect(prefix).toContain("lifting logged on 1 of the last 14 days (thin)");
    expect(prefix).toContain("1 weigh-in (thin)");
  });

  it("tells the model to answer in full, which is what it used to refuse to do", async () => {
    const { prefix } = await dbm.withUser(USER, () => ctx.buildCoachContext(USER, TODAY));

    expect(prefix).toContain("Answer in full regardless.");
    expect(prefix).toContain("Answer the question you were asked, every time.");
    // The sentence that produced "1 logged day is too thin to call."
    expect(prefix).not.toContain("the data is too thin to call and stop");
  });

  it("keeps the owner's goals in front of the coverage block", async () => {
    const { prefix } = await dbm.withUser(USER, () => ctx.buildCoachContext(USER, TODAY));

    // Cache-prefix order AND an argument about what the coach answers from: on
    // a thin log the goals text is the only thing it has, so it cannot be
    // behind the admission that the log is thin.
    expect(prefix.indexOf("205 bench press by December"))
      .toBeLessThan(prefix.indexOf("DATA COVERAGE:"));
    expect(prefix).toContain("Current split: chest, side delts, biceps.");
  });

  it("surfaces the same judgement to the screen", async () => {
    const { coverage } = await dbm.withUser(USER, () => ctx.buildCoachContext(USER, TODAY));
    const note = ctx.coachCoverageNote(coverage);

    expect(note).not.toBeNull();
    expect(note).toContain("still answers");
    expect(note).toContain(String(prompts.THIN_SAMPLE_DAYS));
  });

  it("spans exactly COVERAGE_WINDOW_DAYS dates, counting today as day one", async () => {
    /*
     * The queries behind these counts fetch `localDate >= today - 14`, which is
     * fifteen dates. Left unnarrowed, the block printed "15 weigh-ins" under a
     * heading reading "of the last 14 days" — a number the coach would then
     * quote back. The two rows below sit on either side of the boundary.
     */
    const inside = ctx.coverageSince(TODAY);
    const outside = "2026-10-11"; // today - 14, one day too old.
    expect(inside).toBe("2026-10-12");

    await dbm.withUser(USER, () => dbm.db.insert(schema.bodyMetrics).values([
      { userId: USER, localDate: inside, weightKg: 81.0 },
      { userId: USER, localDate: outside, weightKg: 80.9 },
    ]));

    try {
      const { coverage } = await dbm.withUser(USER, () =>
        ctx.buildCoachContext(USER, TODAY));
      // The original weigh-in plus the one on the boundary; not the older one.
      expect(coverage.weighIns).toBe(2);
    } finally {
      await dbm.withUser(USER, () => dbm.db.delete(schema.bodyMetrics)
        .where(orm.and(
          orm.eq(schema.bodyMetrics.userId, USER),
          orm.inArray(schema.bodyMetrics.localDate, [inside, outside]),
        )));
    }
  });

  it("gives the mid-set context lifting coverage and nothing else", async () => {
    // A question asked on ninety seconds of rest is never about the scale, and
    // a weigh-in count in that prefix is a token spent on a distraction.
    const { prefix } = await dbm.withUser(USER, () =>
      ctx.buildSessionContext(USER, workoutId, TODAY));

    expect(prefix).toContain("DATA COVERAGE: lifting logged on 1 of the last 14 days (thin).");
    expect(prefix).not.toContain("weigh-in");
    expect(prefix).not.toContain("food logged");
    expect(prefix).toContain("Answer in full regardless.");
  });

  it("drops the thin markers once a stream clears the floor", async () => {
    const extra = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"];
    await dbm.withUser(USER, () => dbm.db.insert(schema.meals).values(
      extra.map((localDate) => ({
        userId: USER, localDate, slot: "lunch" as const, source: "manual" as const,
        kcal: 600, proteinG: 45, carbsG: 55, fatG: 20,
      })),
    ));

    try {
      const { coverage, prefix } = await dbm.withUser(USER, () =>
        ctx.buildCoachContext(USER, TODAY));

      expect(coverage.intakeDays).toBe(5);
      expect(prefix).toContain("food logged on 5 of the last 14 days,");
      expect(prefix).not.toContain("food logged on 5 of the last 14 days (thin)");
      // Lifting is still thin, so the legend and the instruction both stay.
      expect(prefix).toContain("lifting logged on 1 of the last 14 days (thin)");
      expect(prefix).toContain("Answer in full regardless.");
    } finally {
      await dbm.withUser(USER, () => dbm.db.delete(schema.meals)
        .where(orm.and(
          orm.eq(schema.meals.userId, USER),
          orm.inArray(schema.meals.localDate, extra),
        )));
    }
  });
});

import "../load-env";
import { adminDb } from "../src/db";
import { workouts, sets, exerciseMuscles, profiles } from "../src/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { deriveWorkoutName, type CountedSet } from "../src/lib/domain/muscles";
import { SESSION_IDLE_MS } from "../src/lib/domain/session";
import { localDate } from "../src/lib/queries";

/**
 * Repairs workouts that two days of lifting were written into.
 *
 * ── WHAT WENT WRONG, AND WHY CODE ALONE CANNOT FIX IT ──────────────────────
 *
 * Until `src/lib/domain/session.ts` existed, a session ended only when someone
 * pressed STOP. A workout walked away from stayed `active` forever, and the
 * next day `POST /api/session/start` resumed it — so the second day's sets
 * were written into the first day's row and inherited its `localDate`. The
 * owner hit this with chest and biceps one day and triceps and back the next:
 *
 *   "it for some reason combined all my stuff into one lift as it thinks today
 *    is all one day"
 *
 * The fix stops it happening again. It does nothing about the rows already
 * written, and those are wrong in a way that matters: the e1RM trend, the
 * lift-day grid, the weekly volume split and "when did I last train back" all
 * read the workout, not the set.
 *
 * ── WHAT THIS DOES ─────────────────────────────────────────────────────────
 *
 * Finds any workout whose sets straddle a gap longer than the idle threshold —
 * the same `SESSION_IDLE_MS` the app now enforces, so this splits exactly what
 * the app would have separated — and cuts it at each gap. The earliest run of
 * sets stays in the original row, so its id and anything pointing at it
 * survive; each later run moves to a new workout with its own `started_at`,
 * `ended_at`, `local_date` and derived name.
 *
 * No set is created, deleted, or has a figure changed. Only `workout_id` and
 * `set_index` move, and `set_index` only so each workout is numbered from 1.
 *
 * ── RUNNING IT ─────────────────────────────────────────────────────────────
 *
 *     npx tsx scripts/split-merged-workouts.ts            # dry run, the default
 *     npx tsx scripts/split-merged-workouts.ts --apply    # writes
 *
 * Dry run by default, and the dry run prints exactly what the apply would do.
 * Read it before passing `--apply`: this is the only script in the repo that
 * rewrites history the app has already shown you.
 *
 * It needs the production `DATABASE_URL`, so it is run from a machine that can
 * reach the database — the cloud container this was written in cannot.
 */

const APPLY = process.argv.includes("--apply");

interface Run {
  startedAt: Date;
  endedAt: Date;
  setIds: string[];
  counted: CountedSet[];
}

async function main(): Promise<void> {
  const open = await adminDb.select({
    id: workouts.id,
    userId: workouts.userId,
    localDate: workouts.localDate,
    name: workouts.name,
    startedAt: workouts.startedAt,
    status: workouts.status,
  }).from(workouts).orderBy(asc(workouts.startedAt));

  const zones = new Map<string, string>();
  for (const p of await adminDb.select({ id: profiles.id, tz: profiles.tz }).from(profiles)) {
    zones.set(p.id, p.tz);
  }

  let split = 0;
  let created = 0;

  for (const workout of open) {
    const rows = await adminDb.select({
      id: sets.id,
      loggedAt: sets.loggedAt,
      isWarmup: sets.isWarmup,
      muscle: exerciseMuscles.muscle,
      contribution: exerciseMuscles.contribution,
    }).from(sets)
      .leftJoin(exerciseMuscles, eq(exerciseMuscles.exerciseId, sets.exerciseId))
      .where(eq(sets.workoutId, workout.id))
      .orderBy(asc(sets.loggedAt));

    if (rows.length === 0) continue;

    /*
     * One row per set, not per set-muscle. The join above fans a set out across
     * every muscle it trains, and counting those as separate sets would both
     * invent gaps that are not there and hand `deriveWorkoutName` a session
     * several times larger than it was.
     */
    const bySet = new Map<string, Run>();
    const order: string[] = [];
    for (const row of rows) {
      if (!bySet.has(row.id)) {
        bySet.set(row.id, {
          startedAt: row.loggedAt, endedAt: row.loggedAt, setIds: [row.id],
          counted: [{ isWarmup: row.isWarmup, muscles: [] }],
        });
        order.push(row.id);
      }
      if (row.muscle) {
        bySet.get(row.id)!.counted[0].muscles.push({
          muscle: row.muscle, contribution: row.contribution!,
        });
      }
    }

    const runs: Run[] = [];
    for (const id of order) {
      const one = bySet.get(id)!;
      const last = runs[runs.length - 1];
      if (last && one.startedAt.getTime() - last.endedAt.getTime() <= SESSION_IDLE_MS) {
        last.endedAt = one.endedAt;
        last.setIds.push(...one.setIds);
        last.counted.push(...one.counted);
      } else {
        runs.push({ ...one, setIds: [...one.setIds], counted: [...one.counted] });
      }
    }

    if (runs.length < 2) continue;

    split += 1;
    const tz = zones.get(workout.userId) ?? "America/New_York";
    console.log(
      `\n${workout.id}  "${workout.name}"  ${workout.localDate}  ` +
      `${rows.length} set-rows → ${runs.length} sessions`,
    );

    for (const [i, run] of runs.entries()) {
      const date = localDate(tz, run.startedAt);
      const name = deriveWorkoutName(run.counted);
      const minutes = Math.round((+run.endedAt - +run.startedAt) / 60_000);
      console.log(
        `  ${i === 0 ? "keep" : "move"}  ${date}  ${run.setIds.length} sets  ` +
        `${minutes} min  "${name}"`,
      );

      if (!APPLY) continue;

      if (i === 0) {
        // The earliest run keeps the original row, so its id survives and the
        // `started_at` the owner actually began at is preserved.
        await adminDb.update(workouts).set({
          localDate: date,
          endedAt: run.endedAt,
          name,
          nameIsCustom: false,
          status: workout.status === "active" ? "completed" : workout.status,
        }).where(eq(workouts.id, workout.id));
      } else {
        const [fresh] = await adminDb.insert(workouts).values({
          userId: workout.userId,
          status: "completed",
          localDate: date,
          startedAt: run.startedAt,
          endedAt: run.endedAt,
          name,
          nameIsCustom: false,
        }).returning({ id: workouts.id });
        created += 1;

        await adminDb.update(sets)
          .set({ workoutId: fresh.id })
          .where(and(eq(sets.workoutId, workout.id), inArray(sets.id, run.setIds)));
      }

      // Numbered from 1 within whichever workout each set now belongs to.
      for (const [n, id] of run.setIds.entries()) {
        await adminDb.update(sets).set({ setIndex: n + 1 }).where(eq(sets.id, id));
      }
    }
  }

  console.log(
    `\n${split} workout(s) to split` +
    (APPLY ? `, ${created} new workout(s) written.` : ". Dry run — nothing was changed."),
  );
  if (!APPLY && split > 0) console.log("Re-run with --apply to write it.");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});

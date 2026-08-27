import "../load-env";
import { adminDb, db, withUser } from "../src/db";
import { profiles, meals, workouts, sets, exercises, stravaAccounts } from "../src/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getDayMeals, getWorkoutSets, getMuscleVolume } from "../src/lib/queries";
import { resolveExercise } from "../src/lib/exercises";

/**
 * Proves the database is actually configured the way the app assumes.
 *
 * Every check here exists because it was wrong, unproven or unprovable at some
 * point: pg_trgm was never installed by `drizzle-kit push`, the generated e1RM
 * column had never been computed by a real Postgres, and the RLS policies were
 * a design note rather than rows in pg_policies. Run it against a fresh
 * Supabase project immediately after `npm run db:migrate && npm run db:seed`.
 *
 * It writes two throwaway users and removes them again; it is safe to re-run.
 */

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function scalar<T = unknown>(query: ReturnType<typeof sql>): Promise<T> {
  const rows = (await adminDb.execute(query)) as unknown as Record<string, T>[];
  return Object.values(rows[0] ?? {})[0] as T;
}

async function cleanup() {
  // profiles cascades to meals, workouts, sets, strava_accounts.
  await adminDb.delete(profiles).where(sql`${profiles.id} in (${A}, ${B})`);
}

async function main() {
  console.log("\nextensions and generated columns");

  const trgm = await scalar<number>(sql`select count(*)::int from pg_extension where extname = 'pg_trgm'`);
  check("pg_trgm installed", Number(trgm) === 1, "fuzzy exercise matching depends on it");

  const sim = await scalar<number>(sql`select similarity('bench press', 'benh pres')`);
  check("similarity() callable", Number(sim) > 0, `similarity('bench press','benh pres') = ${Number(sim).toFixed(3)}`);

  const generated = await scalar<string>(
    sql`select is_generated from information_schema.columns where table_name = 'sets' and column_name = 'e1rm_kg'`,
  );
  check("sets.e1rm_kg is generated", generated === "ALWAYS");

  console.log("\nrow-level security");

  const unprotected = (await adminDb.execute(
    sql`select tablename from pg_tables where schemaname = 'public' and not rowsecurity order by 1`,
  )) as unknown as { tablename: string }[];
  check("every public table has RLS enabled", unprotected.length === 0,
    unprotected.map((r) => r.tablename).join(", "));

  const unpolicied = (await adminDb.execute(sql`
    select t.tablename from pg_tables t
    where t.schemaname = 'public'
      and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename)
    order by 1
  `)) as unknown as { tablename: string }[];
  check("every public table has at least one policy", unpolicied.length === 0,
    unpolicied.map((r) => r.tablename).join(", "));

  const appRoleBypasses = await scalar<boolean>(
    sql`select rolbypassrls from pg_roles where rolname = 'lifemaxx_app'`,
  );
  check("lifemaxx_app does not bypass RLS", appRoleBypasses === false);

  // These two only mean anything where PostgREST's roles exist. On a plain
  // Postgres they would pass for the wrong reason — nothing to grant to — and a
  // check that cannot fail is worse than no check, because it reads as proof.
  const hasAnon = await scalar<boolean>(sql`select exists (select 1 from pg_roles where rolname = 'anon')`);

  if (!hasAnon) {
    console.log("  n/a  anon and authenticated do not exist here — PostgREST grants not applicable");
    console.log("       (run this against the real Supabase project to check them)");
  } else {
    const anonGrants = await scalar<number>(sql`
      select count(*)::int from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public'
    `);
    check("anon has no table privileges", Number(anonGrants) === 0,
      "the anon key is public; this is the PostgREST hole");

    const secretGrants = await scalar<number>(sql`
      select count(*)::int from information_schema.role_table_grants
      where grantee in ('anon', 'authenticated')
        and table_name in ('strava_accounts', 'push_subscriptions')
    `);
    check("OAuth and push secrets unreachable from the browser roles", Number(secretGrants) === 0);
  }

  console.log("\nisolation, through the app's own query layer");

  await cleanup();
  const today = new Date().toISOString().slice(0, 10);

  await adminDb.insert(profiles).values([
    { id: A, email: "verify-a@lifemaxx.local" },
    { id: B, email: "verify-b@lifemaxx.local" },
  ]);
  await adminDb.insert(meals).values([
    { userId: A, localDate: today, slot: "lunch", kcal: 700, proteinG: 50, carbsG: 60, fatG: 20, source: "manual" },
    { userId: B, localDate: today, slot: "lunch", kcal: 800, proteinG: 60, carbsG: 70, fatG: 25, source: "manual" },
  ]);
  const [bench] = await adminDb.select().from(exercises).where(eq(exercises.slug, "barbell-bench-press")).limit(1);
  const [workoutA] = await adminDb.insert(workouts)
    .values({ userId: A, localDate: today, status: "completed" }).returning();
  await adminDb.insert(sets).values({
    workoutId: workoutA.id, exerciseId: bench.id, setIndex: 1, reps: 5, weightKg: 83.9,
  });
  await adminDb.insert(stravaAccounts).values({
    userId: A, athleteId: "1", accessToken: "verify-only", refreshToken: "verify-only",
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  const e1rm = await scalar<number>(
    sql`select e1rm_kg from sets where workout_id = ${workoutA.id}`,
  );
  check("e1RM computes (Epley, 83.9kg x 5)", Math.abs(Number(e1rm) - 97.883) < 0.01, `${Number(e1rm).toFixed(3)} kg`);

  const aMeals = await withUser(A, () => getDayMeals(A, today));
  check("A sees exactly their own meal", aMeals.length === 1 && aMeals[0].kcal === 700);

  // The predicate is the database's, not the query's: ask for B's rows while
  // scoped to A and the policy still returns nothing.
  const bMealsAsA = await withUser(A, () => getDayMeals(B, today));
  check("A cannot read B's meals even when the query asks for them", bMealsAsA.length === 0);

  const bMeals = await withUser(B, () => getDayMeals(B, today));
  check("B sees exactly their own meal", bMeals.length === 1 && bMeals[0].kcal === 800);

  const aSetsAsB = await withUser(B, () => getWorkoutSets(workoutA.id));
  check("B cannot read A's sets through a known workout id", aSetsAsB.length === 0);

  const aTokensAsB = await withUser(B, () =>
    db.select().from(stravaAccounts).where(eq(stravaAccounts.userId, A)));
  check("B cannot read A's Strava tokens", aTokensAsB.length === 0);

  let crossWriteRejected = false;
  try {
    await withUser(A, () => db.insert(meals).values({
      userId: B, localDate: today, slot: "dinner", kcal: 1, proteinG: 1, carbsG: 1, fatG: 1, source: "manual",
    }));
  } catch {
    crossWriteRejected = true;
  }
  check("A cannot write a row owned by B", crossWriteRejected);

  let catalogueWriteRejected = true;
  const updated = await withUser(A, () =>
    db.update(exercises).set({ name: "tampered" }).where(eq(exercises.slug, "barbell-bench-press")).returning());
  catalogueWriteRejected = updated.length === 0;
  check("the shared exercise catalogue is read-only to users", catalogueWriteRejected);

  const catalogue = await withUser(A, () => db.select().from(exercises));
  check("the shared catalogue is still readable", catalogue.length >= 35, `${catalogue.length} exercises`);

  const volume = await withUser(A, () => getMuscleVolume(A, today));
  check("muscle volume resolves under RLS", (volume.states.find((s) => s.muscle === "chest")?.setsLast7d ?? 0) > 0);

  console.log("\noffline outbox guarantees");

  // What makes a retry after a lost response safe. The route upserts on this
  // index; without it the same set lands twice and the session reads wrong.
  const clientId = "eeeeeeee-0000-4000-8000-00000000000e";
  const insertOnce = () => withUser(A, () => db.insert(sets).values({
    workoutId: workoutA.id, exerciseId: bench.id, setIndex: 2,
    reps: 5, weightKg: 83.9, clientId,
  }).onConflictDoUpdate({
    target: [sets.workoutId, sets.clientId],
    set: { reps: 5, weightKg: 83.9 },
  }).returning());

  const firstDelivery = await insertOnce();
  const retry = await insertOnce();
  const rows = await withUser(A, () => db.select().from(sets)
    .where(and(eq(sets.workoutId, workoutA.id), eq(sets.clientId, clientId))));

  check("a retried set does not become two rows", rows.length === 1, `${rows.length} row(s)`);
  check("the retry lands on the row the first attempt wrote",
    firstDelivery[0]?.id === retry[0]?.id);
  check("the retry does not renumber the set",
    rows[0]?.setIndex === firstDelivery[0]?.setIndex, `set_index ${rows[0]?.setIndex}`);

  const fuzzy = await withUser(A, () => resolveExercise("benh pres", A));
  check("fuzzy exercise matching works under RLS", fuzzy?.slug === "barbell-bench-press",
    fuzzy ? `${fuzzy.name} (${fuzzy.confidence})` : "no match");

  const exact = await withUser(A, () => resolveExercise("bench", A));
  check("exact alias matching works under RLS", exact?.slug === "barbell-bench-press");

  await cleanup();
  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  process.exit(1);
});

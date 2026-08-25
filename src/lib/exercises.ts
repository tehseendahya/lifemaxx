import { db } from "@/db";
import { exercises, exerciseAliases, exerciseMuscles } from "@/db/schema";
import { and, eq, isNull, or, sql } from "drizzle-orm";

/**
 * Exercise resolution.
 *
 * This is the part that quietly breaks these apps: "bench", "bp", "barbell
 * bench press" and "flat bench" must all land on one row, or the trend charts
 * fragment into confetti and every progression calculation is wrong.
 *
 * Three tiers, cheapest first — the model is a last resort, not a first step.
 */

export interface ResolvedExercise {
  id: string;
  name: string;
  slug: string;
  incrementKg: number;
  equipment: string;
  confidence: "exact" | "fuzzy" | "none";
}

const normalise = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");

export async function resolveExercise(
  query: string,
  userId: string,
): Promise<ResolvedExercise | null> {
  const alias = normalise(query);
  if (!alias) return null;

  // 1. Exact alias match — covers the overwhelming majority of entries.
  const exact = await db
    .select({
      id: exercises.id, name: exercises.name, slug: exercises.slug,
      incrementKg: exercises.incrementKg, equipment: exercises.equipment,
    })
    .from(exerciseAliases)
    .innerJoin(exercises, eq(exercises.id, exerciseAliases.exerciseId))
    .where(and(
      eq(exerciseAliases.alias, alias),
      or(isNull(exerciseAliases.userId), eq(exerciseAliases.userId, userId)),
    ))
    .limit(1);

  if (exact.length > 0) return { ...exact[0], confidence: "exact" };

  // 2. Trigram similarity. Catches typos and word-order variation without a
  //    round trip. Threshold is deliberately high — a wrong match silently
  //    corrupts history, which is worse than asking.
  const fuzzy = await db
    .select({
      id: exercises.id, name: exercises.name, slug: exercises.slug,
      incrementKg: exercises.incrementKg, equipment: exercises.equipment,
      score: sql<number>`similarity(${exerciseAliases.alias}, ${alias})`,
    })
    .from(exerciseAliases)
    .innerJoin(exercises, eq(exercises.id, exerciseAliases.exerciseId))
    .where(and(
      sql`similarity(${exerciseAliases.alias}, ${alias}) > 0.45`,
      or(isNull(exerciseAliases.userId), eq(exerciseAliases.userId, userId)),
    ))
    .orderBy(sql`similarity(${exerciseAliases.alias}, ${alias}) DESC`)
    .limit(1);

  if (fuzzy.length > 0) {
    const { score, ...rest } = fuzzy[0];
    return { ...rest, confidence: "fuzzy" };
  }

  // 3. Caller decides whether to ask the model or the user.
  return null;
}

/** Remember a resolution so the same wording is free next time. */
export async function learnAlias(exerciseId: string, alias: string, userId: string) {
  await db.insert(exerciseAliases)
    .values({ exerciseId, alias: normalise(alias), userId })
    .onConflictDoNothing();
}

export async function musclesFor(exerciseIds: string[]) {
  if (exerciseIds.length === 0) return new Map<string, { muscle: string; contribution: number }[]>();
  const rows = await db.select().from(exerciseMuscles)
    .where(sql`${exerciseMuscles.exerciseId} = ANY(${exerciseIds})`);
  const map = new Map<string, { muscle: string; contribution: number }[]>();
  for (const r of rows) {
    const list = map.get(r.exerciseId) ?? [];
    list.push({ muscle: r.muscle, contribution: r.contribution });
    map.set(r.exerciseId, list);
  }
  return map;
}

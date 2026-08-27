import "../../load-env";
import { db } from "./index";
import { exercises, exerciseAliases, exerciseMuscles, type Muscle } from "./schema";
import { CATALOGUE } from "./catalogue";
import { lbToKg } from "@/lib/domain/units";
import { eq, isNull } from "drizzle-orm";

/** Idempotent: safe to re-run after editing the catalogue. */
async function seed() {
  console.log(`Seeding ${CATALOGUE.length} exercises…`);

  for (const entry of CATALOGUE) {
    const existing = await db.select().from(exercises)
      .where(eq(exercises.slug, entry.slug)).limit(1);

    let id: string;
    if (existing.length > 0) {
      id = existing[0].id;
      await db.update(exercises).set({
        name: entry.name,
        equipment: entry.equipment,
        isUnilateral: entry.isUnilateral ?? false,
        incrementKg: lbToKg(entry.incrementLb),
      }).where(eq(exercises.id, id));
    } else {
      const [row] = await db.insert(exercises).values({
        name: entry.name,
        slug: entry.slug,
        userId: null,
        equipment: entry.equipment,
        isUnilateral: entry.isUnilateral ?? false,
        incrementKg: lbToKg(entry.incrementLb),
      }).returning({ id: exercises.id });
      id = row.id;
    }

    await db.delete(exerciseMuscles).where(eq(exerciseMuscles.exerciseId, id));
    await db.insert(exerciseMuscles).values(
      Object.entries(entry.muscles).map(([muscle, contribution]) => ({
        exerciseId: id,
        muscle: muscle as Muscle,
        contribution: contribution as number,
      })),
    );

    const aliases = [...new Set([entry.slug.replace(/-/g, " "), entry.name.toLowerCase(), ...entry.aliases])];
    for (const alias of aliases) {
      await db.insert(exerciseAliases)
        .values({ exerciseId: id, alias: alias.toLowerCase().trim(), userId: null })
        .onConflictDoNothing();
    }
  }

  const total = await db.select().from(exercises).where(isNull(exercises.userId));
  console.log(`Done. ${total.length} catalogue exercises present.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

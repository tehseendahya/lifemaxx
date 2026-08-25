import { route } from "@/lib/api";
import { db } from "@/db";
import { meals, mealItems } from "@/db/schema";
import { and, eq } from "drizzle-orm";

interface SaveBody {
  slot: "breakfast" | "lunch" | "dinner" | "snack";
  note?: string;
  source: "photo" | "text" | "repeat" | "manual";
  confidence?: number | null;
  localDate?: string;
  items: Array<{
    name: string; qty: number | null; unit: string | null;
    kcal: number; protein_g: number; carbs_g: number; fat_g: number;
  }>;
}

export const POST = route<SaveBody>(async ({ userId, today, body }) => {
  if (!body.items?.length) throw new Error("A meal needs at least one item.");

  const totals = body.items.reduce(
    (a, i) => ({
      kcal: a.kcal + i.kcal, proteinG: a.proteinG + i.protein_g,
      carbsG: a.carbsG + i.carbs_g, fatG: a.fatG + i.fat_g,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );

  const [meal] = await db.insert(meals).values({
    userId,
    localDate: body.localDate ?? today,
    slot: body.slot,
    note: body.note ?? "",
    source: body.source,
    confidence: body.confidence ?? null,
    kcal: Math.round(totals.kcal),
    proteinG: totals.proteinG,
    carbsG: totals.carbsG,
    fatG: totals.fatG,
  }).returning();

  await db.insert(mealItems).values(
    body.items.map((i) => ({
      mealId: meal.id, name: i.name, qty: i.qty, unit: i.unit,
      kcal: Math.round(i.kcal), proteinG: i.protein_g,
      carbsG: i.carbs_g, fatG: i.fat_g,
    })),
  );

  return { meal };
});

export const DELETE = route<{ id: string }>(async ({ userId, body }) => {
  await db.delete(meals).where(and(eq(meals.id, body.id), eq(meals.userId, userId)));
  return { ok: true };
});

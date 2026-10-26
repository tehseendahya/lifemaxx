import { route, HttpError } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { db } from "@/db";
import { meals, mealItems } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { mealAnalysisSchema } from "@/lib/llm/schemas";
import { requireUuid } from "../shared";

/**
 * Editing a logged meal: the phone's item editor saves through here.
 *
 * The owner asked to "be able to edit when click in" on the day's meals, and
 * the edit is MacroFactor-style — change a quantity, fix a macro, drop an
 * item, add one, move it to another slot. So the body is the whole edited
 * meal rather than a patch: `{ id, slot, note, items }`, and the items replace
 * the stored ones wholesale. A patch protocol over a list the user reorders,
 * splices and appends to would be three endpoints and a merge for no gain;
 * a meal is a handful of rows.
 *
 * ── WHAT IT KEEPS, WHAT IT CHANGES ────────────────────────────────────────
 *
 *  - `source` and `localDate` are kept. Editing a photo estimate does not make
 *    it typed, and fixing yesterday's dinner must not move it to today.
 *  - `confidence` becomes null. It was the model's claim about its own
 *    estimate; once a person has corrected the numbers it no longer describes
 *    them (the same reason a repeat posts `confidence: null`).
 *  - The totals are recomputed here from the items, never taken from the
 *    client, with the same reduction and rounding `POST /api/meals` uses.
 *
 * ── ONE TRANSACTION ───────────────────────────────────────────────────────
 *
 * `route()`'s default scope runs the whole handler inside `withUser()`, which
 * is one Postgres transaction. The ownership read, the item delete, the
 * insert and the meal update therefore commit together or not at all — a
 * failed insert cannot leave a meal with no items and stale totals.
 *
 * POST rather than PUT/PATCH because the mobile API client has no PUT helper
 * and the plan forbids adding one.
 */

const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
type Slot = (typeof SLOTS)[number];

/**
 * The item shape is the model's schema, reused rather than restated: the
 * phone posts exactly the snake_case items `/api/meals/analyze` returned and
 * `POST /api/meals` accepts, and a second hand-written validator would be a
 * second definition of the same contract that could drift from the first.
 */
const itemsSchema = mealAnalysisSchema.shape.items;

interface Body {
  id?: string;
  slot?: string;
  note?: string;
  items?: unknown;
}

export const POST = route<Body>(async ({ userId, body }) => {
  const id = requireUuid(typeof body.id === "string" ? body.id : null, "id");

  if (!SLOTS.includes(body.slot as Slot)) {
    throw new HttpError("slot must be breakfast, lunch, dinner or snack.");
  }
  const slot = body.slot as Slot;

  if (body.note !== undefined && typeof body.note !== "string") {
    throw new HttpError("note must be a string.");
  }

  const parsed = itemsSchema.safeParse(body.items);
  if (!parsed.success) throw new HttpError("items are not in the expected shape.");
  const items = parsed.data;
  // Same rule and same words as `POST /api/meals`. A meal with nothing in it is
  // a delete, and the phone offers that instead.
  if (items.length === 0) throw new HttpError("A meal needs at least one item.");

  // Scoped by user as well as by id. RLS already guarantees it; this keeps
  // another user's meal a 404 rather than an update that silently matches
  // nothing after its items were already deleted.
  const [existing] = await db.select({ id: meals.id })
    .from(meals)
    .where(and(eq(meals.id, id), eq(meals.userId, userId)))
    .limit(1);
  if (!existing) throw new HttpError("Unknown meal.", 404);

  const totals = items.reduce(
    (a, i) => ({
      kcal: a.kcal + i.kcal, proteinG: a.proteinG + i.protein_g,
      carbsG: a.carbsG + i.carbs_g, fatG: a.fatG + i.fat_g,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );

  await db.delete(mealItems).where(eq(mealItems.mealId, id));

  const inserted = await db.insert(mealItems).values(
    items.map((i) => ({
      mealId: id, name: i.name.trim() === "" ? "Item" : i.name.trim(), qty: i.qty, unit: i.unit,
      kcal: Math.round(i.kcal), proteinG: i.protein_g,
      carbsG: i.carbs_g, fatG: i.fat_g,
    })),
  ).returning();

  const [meal] = await db.update(meals)
    .set({
      slot,
      note: (body.note ?? "").trim(),
      kcal: Math.round(totals.kcal),
      proteinG: totals.proteinG,
      carbsG: totals.carbsG,
      fatG: totals.fatG,
      confidence: null,
    })
    .where(and(eq(meals.id, id), eq(meals.userId, userId)))
    .returning();

  if (!meal) throw new HttpError("Unknown meal.", 404);

  // The same primitives-only shape `GET /api/mobile/food` sends, so the phone
  // can treat the reply as a `MealDto` without a second mapping.
  return {
    meal: {
      id: meal.id,
      slot: meal.slot,
      note: meal.note,
      source: meal.source,
      confidence: meal.confidence,
      localDate: meal.localDate,
      kcal: meal.kcal,
      proteinG: meal.proteinG,
      carbsG: meal.carbsG,
      fatG: meal.fatG,
      items: inserted.map((i) => ({
        name: i.name, qty: i.qty, unit: i.unit,
        kcal: i.kcal, proteinG: i.proteinG, carbsG: i.carbsG, fatG: i.fatG,
      })),
    },
  };
});

export const OPTIONS = preflight;

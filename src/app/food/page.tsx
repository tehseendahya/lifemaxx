import { currentUserId } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getProfile, localDate, getDayMeals, sumMacros, getActiveTarget, defaultProteinTarget } from "@/lib/queries";
import { FoodClient } from "./FoodClient";

export const dynamic = "force-dynamic";

export default async function Food() {
  const userId = await currentUserId();
  if (!userId) redirect("/login");

  const profile = await getProfile(userId);
  const today = localDate(profile?.tz ?? "America/New_York");
  const [meals, target, proteinFloor] = await Promise.all([
    getDayMeals(userId, today),
    getActiveTarget(userId, today),
    defaultProteinTarget(userId),
  ]);

  const totals = sumMacros(meals);

  return (
    <FoodClient
      meals={meals.map((m) => ({
        id: m.id, slot: m.slot, note: m.note, kcal: m.kcal,
        proteinG: m.proteinG, carbsG: m.carbsG, fatG: m.fatG,
        items: m.items.map((i) => ({ name: i.name, kcal: i.kcal })),
      }))}
      totals={totals}
      kcalTarget={target?.kcal ?? null}
      proteinTarget={target?.proteinG ?? proteinFloor}
    />
  );
}

import { currentUserId } from "@/lib/supabase/server";
import { withUser } from "@/db";
import { redirect } from "next/navigation";
import { getProfile, localDate, getDayMeals, sumMacros, getActiveTarget, defaultProteinTarget } from "@/lib/queries";
import { FoodClient } from "./FoodClient";

export const dynamic = "force-dynamic";

export default async function Food() {
  const userId = await currentUserId();
  if (!userId) redirect("/login");

  // Read inside a user scope, so the RLS policies do the filtering here the
  // same way they do in the API routes. See withUser() in src/db/index.ts.
  const { meals, target, proteinFloor } = await withUser(userId, async () => {
    const profile = await getProfile(userId);
    const today = localDate(profile?.tz ?? "America/New_York");
    const [meals, target, proteinFloor] = await Promise.all([
      getDayMeals(userId, today),
      getActiveTarget(userId, today),
      defaultProteinTarget(userId),
    ]);
    return { meals, target, proteinFloor };
  });

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

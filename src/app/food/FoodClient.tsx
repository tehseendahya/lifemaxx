"use client";
import { useRouter } from "next/navigation";
import { Screen, Card, Label, Empty, MacroBar } from "@/components/ui";
import { MealCapture } from "@/components/MealCapture";

interface Meal {
  id: string; slot: string; note: string; kcal: number;
  proteinG: number; carbsG: number; fatG: number;
  items: { name: string; kcal: number }[];
}

export function FoodClient({ meals, totals, kcalTarget, proteinTarget }: {
  meals: Meal[];
  totals: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  kcalTarget: number | null;
  proteinTarget: number;
}) {
  const router = useRouter();

  async function remove(id: string) {
    await fetch("/api/meals", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  return (
    <Screen title="Food" subtitle="Photo or text — the note matters more than the picture">
      <MealCapture onSaved={() => router.refresh()} />

      <Card className="mb-4">
        <Label>Today</Label>
        <div className="mb-3 flex items-baseline gap-2">
          <span className="tnum text-3xl font-semibold">{Math.round(totals.kcal)}</span>
          <span className="text-sm text-muted">{kcalTarget ? `of ${kcalTarget} kcal` : "kcal"}</span>
        </div>
        <div className="space-y-2.5">
          <MacroBar label="Protein" value={totals.proteinG} target={proteinTarget} tone="good" />
          <MacroBar label="Carbs" value={totals.carbsG} />
          <MacroBar label="Fat" value={totals.fatG} />
        </div>
      </Card>

      {meals.length === 0 ? (
        <Empty>Nothing logged today. Snap a photo above.</Empty>
      ) : (
        <div className="space-y-2">
          {meals.map((meal) => (
            <Card key={meal.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                    {meal.slot}
                  </div>
                  <div className="mt-0.5 truncate text-sm">
                    {meal.items.map((i) => i.name).join(", ") || meal.note || "Meal"}
                  </div>
                  <div className="tnum mt-1 text-xs text-muted">
                    {meal.kcal} kcal · {Math.round(meal.proteinG)}p {Math.round(meal.carbsG)}c {Math.round(meal.fatG)}f
                  </div>
                </div>
                <button
                  onClick={() => remove(meal.id)}
                  className="shrink-0 px-1 text-muted"
                  aria-label="Delete meal"
                >×</button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Screen>
  );
}

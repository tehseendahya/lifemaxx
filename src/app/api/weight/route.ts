import { route } from "@/lib/api";
import { db } from "@/db";
import { bodyMetrics } from "@/db/schema";
import { lbToKg } from "@/lib/domain/units";

export const POST = route<{ weightLb: number; localDate?: string }>(async ({ userId, today, body }) => {
  if (!(body.weightLb > 0)) throw new Error("Enter a weight.");
  const date = body.localDate ?? today;

  const [row] = await db.insert(bodyMetrics)
    .values({ userId, localDate: date, weightKg: lbToKg(body.weightLb), source: "manual" })
    .onConflictDoUpdate({
      target: [bodyMetrics.userId, bodyMetrics.localDate],
      set: { weightKg: lbToKg(body.weightLb) },
    })
    .returning();

  return { entry: row };
});

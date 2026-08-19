import { route } from "@/lib/api";
import { db } from "@/db";
import { profiles, goalHistory } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getProfile } from "@/lib/queries";

export const POST = route<{ goalsText?: string; tz?: string }>(async ({ userId, body }) => {
  const existing = await getProfile(userId);
  if (!existing) throw new Error("No profile.");

  const goals = body.goalsText?.trim();

  // Goals are versioned rather than overwritten — six months from now you'll
  // want to know what you were actually training for in August.
  if (goals !== undefined && goals !== existing.goalsText) {
    await db.insert(goalHistory).values({ userId, goalsText: goals });
  }

  const [row] = await db.update(profiles).set({
    goalsText: goals ?? existing.goalsText,
    tz: body.tz ?? existing.tz,
    updatedAt: new Date(),
  }).where(eq(profiles.id, userId)).returning();

  return { profile: row };
});

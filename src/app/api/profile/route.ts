import { route } from "@/lib/api";
import { db } from "@/db";
import { profiles, goalHistory } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getProfile } from "@/lib/queries";
import { normaliseTimezone } from "@/lib/domain/timezone";

export const POST = route<{ goalsText?: string; tz?: string }>(async ({ userId, body }) => {
  const existing = await getProfile(userId);
  if (!existing) throw new Error("No profile.");

  const goals = body.goalsText?.trim();

  /*
   * The phone reports its own zone, and this is where it lands.
   *
   * It had to, because until now nothing ever set this column: it sat on its
   * `America/New_York` default for every account, and `localDate()` — which
   * decides what "today" means for the dashboard, the lift-day grid and the
   * 9pm verdict — was computed in New York time no matter where the phone
   * was. Three hours west of it, anything logged after 9pm was already
   * tomorrow.
   *
   * `null` from `normaliseTimezone` means "unusable, keep what you had". It
   * must not fall through to a default: `localDate` THROWS on a zone this
   * runtime cannot format, and it runs inside `route()` on the way into every
   * authenticated handler, so one bad value here would 500 the entire app.
   */
  const tz = normaliseTimezone(body.tz);

  // Goals are versioned rather than overwritten — six months from now you'll
  // want to know what you were actually training for in August.
  if (goals !== undefined && goals !== existing.goalsText) {
    await db.insert(goalHistory).values({ userId, goalsText: goals });
  }

  const [row] = await db.update(profiles).set({
    goalsText: goals ?? existing.goalsText,
    tz: tz ?? existing.tz,
    updatedAt: new Date(),
  }).where(eq(profiles.id, userId)).returning();

  return { profile: row };
});

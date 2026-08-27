import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron";
import { adminDb, db, withUser } from "@/db";
import { profiles, dailySummaries } from "@/db/schema";
import { getLlm } from "@/lib/llm";
import { MODELS } from "@/lib/models";
import { COACH_VOICE, goalsBlock, stableJson } from "@/lib/llm/prompts";
import {
  localDate, getDayMeals, sumMacros, getActiveTarget,
  defaultProteinTarget, getMuscleVolume,
} from "@/lib/queries";
import { sendPush } from "@/lib/push";

export const maxDuration = 60;

/**
 * The 9pm verdict.
 *
 * Rules that matter more than the prompt: never notify on a day with no data
 * (an empty nudge is how people turn notifications off), and never send a fact
 * where advice belongs.
 *
 * Enumerating every profile is the one thing here that legitimately crosses
 * users, so it uses `adminDb` explicitly; everything after it is scoped to one
 * user at a time and subject to the same RLS policies as a request.
 */
export async function GET(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const users = await adminDb.select().from(profiles);
  const results: { userId: string; sent: boolean }[] = [];

  for (const user of users) {
    const today = localDate(user.tz);

    const summary = await withUser(user.id, async () => {
      const meals = await getDayMeals(user.id, today);
      // Nothing logged means nothing to say. Silence beats noise.
      if (meals.length === 0) return null;

      const totals = sumMacros(meals);
      const [target, proteinFloor, volume] = await Promise.all([
        getActiveTarget(user.id, today),
        defaultProteinTarget(user.id),
        getMuscleVolume(user.id, today),
      ]);

      return {
        kcal: Math.round(totals.kcal),
        protein_g: Math.round(totals.proteinG),
        protein_target_g: target?.proteinG ?? proteinFloor,
        kcal_target: target?.kcal ?? null,
        meals_logged: meals.length,
        muscles_owed: volume.ranked.filter((r) => r.score > 0.2).slice(0, 3).map((r) => r.label),
      };
    });

    if (!summary) {
      results.push({ userId: user.id, sent: false });
      continue;
    }

    let verdict = "";
    try {
      verdict = await getLlm().text({
        model: MODELS.digest,
        messages: [
          { role: "system", content: `${goalsBlock(user.goalsText)}\n\n${COACH_VOICE}` },
          {
            role: "user",
            content: `Today's totals:\n${stableJson(summary)}\n\nWrite the end-of-day verdict. Two sentences. Lead with whatever is off, and give exactly one thing to do about it.`,
          },
        ],
        maxTokens: 200,
      });
    } catch (err) {
      console.error("[cron/nightly]", err);
      continue;
    }

    await withUser(user.id, async () => {
      await db.insert(dailySummaries).values({
        userId: user.id, localDate: today, totals: summary, verdict,
      }).onConflictDoUpdate({
        target: [dailySummaries.userId, dailySummaries.localDate],
        set: { totals: summary, verdict, generatedAt: new Date() },
      });
    });

    await sendPush(user.id, { title: "Today's verdict", body: verdict, url: "/" });
    results.push({ userId: user.id, sent: true });
  }

  return NextResponse.json({ ok: true, results });
}

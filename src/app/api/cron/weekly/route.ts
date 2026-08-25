import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron";
import { adminDb, withUser } from "@/db";
import { profiles } from "@/db/schema";
import { getLlm } from "@/lib/llm";
import { MODELS } from "@/lib/models";
import { buildCoachContext } from "@/lib/llm/context";
import { localDate } from "@/lib/queries";
import { sendPush } from "@/lib/push";

export const maxDuration = 60;

/** Sunday review. Weight trend against intake, what moved, what stalled. */
export async function GET(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  // The only cross-user step; everything below is scoped to one user.
  const users = await adminDb.select().from(profiles);

  for (const user of users) {
    const today = localDate(user.tz);
    const { prefix, loggedDays } = await withUser(user.id, () =>
      buildCoachContext(user.id, today));

    // Under five logged days the honest answer is that the trend is noise.
    if (loggedDays < 5) continue;

    try {
      const review = await getLlm().text({
        model: MODELS.digest,
        messages: [
          { role: "system", content: prefix },
          {
            role: "user",
            content:
              "Write the weekly review. Three sentences maximum: what the weight trend and intake actually say, which lift or muscle group moved or stalled, and the single thing to change this week. If the goals are competing, say which one was traded against.",
          },
        ],
        maxTokens: 350,
      });

      await sendPush(user.id, { title: "Weekly review", body: review, url: "/coach" });
    } catch (err) {
      console.error("[cron/weekly]", err);
    }
  }

  return NextResponse.json({ ok: true });
}

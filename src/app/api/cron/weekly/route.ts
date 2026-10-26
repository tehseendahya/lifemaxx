import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron";
import { adminDb, withUser } from "@/db";
import { profiles } from "@/db/schema";
import { getLlm } from "@/lib/llm";
import { MODELS } from "@/lib/models";
import { buildCoachContext } from "@/lib/llm/context";
import { localDate } from "@/lib/queries";
import { sendPush } from "@/lib/push";
import { generateWeeklyRunningSummary } from "@/lib/running";

export const maxDuration = 60;

/** Sunday review. Weight trend against intake, what moved, what stalled. */
export async function GET(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  // The only cross-user step; everything below is scoped to one user.
  const users = await adminDb.select().from(profiles);

  for (const user of users) {
    const today = localDate(user.tz);

    // The running rollup stands on its own: it has its own data, its own
    // threshold and its own screen, so a thin nutrition week must not suppress
    // it. Half-marathon prep is a dated goal.
    try {
      const running = await generateWeeklyRunningSummary(user.id, user.goalsText, today);
      if (running) await sendPush(user.id, { title: "Running week", body: running, url: "/runs" });
    } catch (err) {
      console.error("[cron/weekly] running", err);
    }

    const { prefix, loggedDays } = await withUser(user.id, () =>
      buildCoachContext(user.id, today));

    /*
     * Nothing logged all week means there is no week to review, and an empty
     * nudge is how people turn notifications off — the same rule the nightly
     * verdict follows. One day is a different case: the review is still worth
     * sending, it just says so inside itself. The prefix carries a DATA
     * COVERAGE block marking the thin streams, and the voice rules forbid
     * calling a trend off them, so a one-day week produces a review about the
     * goals and the plan rather than a fabricated trend. It used to skip under
     * five days, which is why a new user's first month was silent.
     */
    if (loggedDays === 0) continue;

    try {
      const review = await getLlm().text({
        model: MODELS.digest,
        messages: [
          { role: "system", content: prefix },
          {
            role: "user",
            content:
              "Write the weekly review. Three sentences maximum: what the weight trend and intake actually say, which lift or muscle group moved or stalled, and the single thing to change this week. Where a stream is marked thin, say what it does not yet show and move on — do not drop the sentence. If the goals are competing, say which one was traded against.",
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

import { currentUserId } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { coachMessages } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getProfile, localDate } from "@/lib/queries";
import { buildCoachContext } from "@/lib/llm/context";
import { CoachClient } from "./CoachClient";

export const dynamic = "force-dynamic";

export default async function Coach() {
  const userId = await currentUserId();
  if (!userId) redirect("/login");

  const profile = await getProfile(userId);
  const today = localDate(profile?.tz ?? "America/New_York");
  const [{ loggedDays }, history] = await Promise.all([
    buildCoachContext(userId, today),
    db.select().from(coachMessages).where(eq(coachMessages.userId, userId))
      .orderBy(desc(coachMessages.createdAt)).limit(20),
  ]);

  return (
    <CoachClient
      loggedDays={loggedDays}
      history={history.reverse().map((m) => ({ role: m.role, content: m.content }))}
    />
  );
}

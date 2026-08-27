import { currentUserId } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getProfile, localDate, getTdee, latestBodyweightKg, getGyms, getWeighIns } from "@/lib/queries";
import { db, withUser } from "@/db";
import { stravaAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { displayLb } from "@/lib/domain/units";
import { proposeTargets } from "@/lib/domain/tdee";
import { SettingsClient } from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const userId = await currentUserId();
  if (!userId) redirect("/login");

  // Read inside a user scope, so the RLS policies do the filtering here the
  // same way they do in the API routes. See withUser() in src/db/index.ts.
  const { profile, tdee, bwKg, gymList, weighIns, strava } = await withUser(userId, async () => {
    const profile = await getProfile(userId);
    const today = localDate(profile?.tz ?? "America/New_York");
    const [tdee, bwKg, gymList, weighIns, strava] = await Promise.all([
      getTdee(userId, today),
      latestBodyweightKg(userId),
      getGyms(userId),
      getWeighIns(userId, today),
      db.select({ userId: stravaAccounts.userId }).from(stravaAccounts)
        .where(eq(stravaAccounts.userId, userId)).limit(1),
    ]);
    return { profile, tdee, bwKg, gymList, weighIns, strava };
  });

  const proposals = tdee.status === "ok" && bwKg ? proposeTargets(tdee.tdee, bwKg) : null;

  return (
    <SettingsClient
      goalsText={profile?.goalsText ?? ""}
      email={profile?.email ?? ""}
      currentWeightLb={bwKg ? displayLb(bwKg) : null}
      tdee={tdee}
      proposals={proposals}
      gyms={gymList.map((g) => ({ id: g.id, name: g.name, equipmentNotes: g.equipmentNotes }))}
      weighInCount={weighIns.length}
      stravaConnected={strava.length > 0}
    />
  );
}

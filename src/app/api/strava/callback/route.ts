import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/supabase/server";
import { exchangeCode, syncActivities } from "@/lib/strava";
import { db } from "@/db";
import { stravaAccounts } from "@/db/schema";
import { getProfile } from "@/lib/queries";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const userId = await currentUserId();
  // state carries the user id we issued; a mismatch means it isn't our flow.
  if (!userId || !code || state !== userId) {
    return NextResponse.redirect(new URL("/settings?strava=failed", req.url));
  }

  try {
    const token = await exchangeCode(code);
    await db.insert(stravaAccounts).values({
      userId,
      athleteId: String(token.athlete?.id ?? ""),
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(token.expires_at * 1000),
    }).onConflictDoUpdate({
      target: stravaAccounts.userId,
      set: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(token.expires_at * 1000),
      },
    });

    const profile = await getProfile(userId);
    await syncActivities(userId, profile?.tz ?? "America/New_York");
  } catch (err) {
    console.error("[strava/callback]", err);
    return NextResponse.redirect(new URL("/settings?strava=failed", req.url));
  }

  return NextResponse.redirect(new URL("/settings?strava=connected", req.url));
}

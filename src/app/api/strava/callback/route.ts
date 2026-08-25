import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { currentUserId } from "@/lib/supabase/server";
import { exchangeCode, syncActivities, STRAVA_STATE_COOKIE } from "@/lib/strava";
import { db, withUser } from "@/db";
import { stravaAccounts } from "@/db/schema";
import { getProfile } from "@/lib/queries";

function statesMatch(a: string | undefined, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const userId = await currentUserId();
  const expected = (await cookies()).get(STRAVA_STATE_COOKIE)?.value;

  const fail = () => {
    const response = NextResponse.redirect(new URL("/settings?strava=failed", req.url));
    response.cookies.delete(STRAVA_STATE_COOKIE);
    return response;
  };

  if (!userId || !code || !statesMatch(expected, state)) return fail();

  try {
    const token = await exchangeCode(code);

    await withUser(userId, () => db.insert(stravaAccounts).values({
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
    }));

    const profile = await withUser(userId, () => getProfile(userId));
    await syncActivities(userId, profile?.tz ?? "America/New_York");
  } catch (err) {
    console.error("[strava/callback]", err);
    return fail();
  }

  const response = NextResponse.redirect(new URL("/settings?strava=connected", req.url));
  response.cookies.delete(STRAVA_STATE_COOKIE);
  return response;
}

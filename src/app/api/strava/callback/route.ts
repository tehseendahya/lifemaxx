import { NextResponse } from "next/server";
import { exchangeCode, syncActivities } from "@/lib/strava";
import { stravaStateSecret, verifyStravaState } from "@/lib/strava-state";
import { db, withUser } from "@/db";
import { stravaAccounts } from "@/db/schema";
import { getProfile } from "@/lib/queries";

/**
 * Where Strava sends the user back after they approve (or decline).
 *
 * The user id comes from the signed `state` that `POST /api/mobile/strava/
 * connect` minted, and from nowhere else. There is deliberately no cookie or
 * session lookup: this request usually arrives in Safari on the phone, which
 * has neither, and a cookie that happened to be present would be a second
 * opinion about who the user is that could disagree with the first.
 *
 * Either way it ends on the client's You screen, which reads `?strava=` to say
 * what happened.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const done = (outcome: "connected" | "error") =>
    NextResponse.redirect(new URL(`/you?strava=${outcome}`, req.url));

  const code = url.searchParams.get("code");
  // `error=access_denied` (the user pressed Cancel) arrives with no code and
  // lands here too.
  const userId = verifyStravaState(url.searchParams.get("state"), stravaStateSecret());
  if (!userId || !code) return done("error");

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
    return done("error");
  }

  return done("connected");
}

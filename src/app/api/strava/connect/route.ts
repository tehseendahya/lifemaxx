import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { currentUserId } from "@/lib/supabase/server";
import { authorizeUrl, STRAVA_STATE_COOKIE } from "@/lib/strava";

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.redirect(new URL("/login", req.url));

  // The state was the user id, which is the wrong secret: it is not one. Anyone
  // who learned it could hand the victim a callback URL carrying their own
  // Strava code and bind their account to the victim's. A per-attempt nonce in
  // an httpOnly cookie is the standard fix — unguessable, and tied to the
  // browser that started the flow.
  const state = randomBytes(32).toString("base64url");
  const redirectUri = `${new URL(req.url).origin}/api/strava/callback`;

  const response = NextResponse.redirect(authorizeUrl(redirectUri, state));
  response.cookies.set(STRAVA_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/strava",
    maxAge: 600,
  });
  return response;
}

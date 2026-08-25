import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/supabase/server";
import { authorizeUrl } from "@/lib/strava";

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.redirect(new URL("/login", req.url));

  const redirectUri = `${new URL(req.url).origin}/api/strava/callback`;
  return NextResponse.redirect(authorizeUrl(redirectUri, userId));
}

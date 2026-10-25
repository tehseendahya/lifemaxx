import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { corsHeadersFor, preflight } from "@/lib/auth/cors";
import { ensureProfile } from "@/lib/ensure-profile";

/**
 * Called once a session exists — by the web login screen after GoTrue
 * establishes one, and by the native sign-in screen for the same reason.
 *
 * The id is taken from the verified session, never from the request body —
 * this endpoint writes a row keyed to a user id, and accepting that id from
 * the client would let anyone create or claim a profile that is not theirs.
 * `currentUser` is what makes that work for both callers: a cookie session for
 * the browser, a verified bearer token for the phone, and the email comes from
 * whichever of the two resolved.
 */
export async function POST(req: Request) {
  const headers = corsHeadersFor(req);

  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401, headers });

  await ensureProfile(user.id, user.email);
  return NextResponse.json({ ok: true }, { headers });
}

export const OPTIONS = preflight;

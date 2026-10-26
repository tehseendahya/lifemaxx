import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/supabase/server";
import { corsHeadersFor, preflight } from "@/lib/auth/cors";
import { jsonError } from "@/lib/api";
import { authorizeUrl } from "@/lib/strava";
import { createStravaState, stravaStateSecret } from "@/lib/strava-state";

/**
 * `POST /api/mobile/strava/connect` → `{ url }`: where to send the user to
 * approve Strava.
 *
 * A POST that returns a URL rather than a GET that redirects, because the
 * caller authenticates with a bearer header, and a browser navigation (the
 * phone opening Safari, the laptop following a link) cannot carry one. So the
 * client asks here with its token, gets the authorize URL back, and opens it.
 * The `state` inside it is what carries the user's identity through Strava to
 * the callback — see `src/lib/strava-state.ts` for how, and for the one thing
 * that gives up relative to the old cookie flow.
 *
 * Not wrapped in `route()`: there is no database work here, and `route()`
 * would open a transaction and read the profile for nothing.
 */
export async function POST(req: Request) {
  const headers = corsHeadersFor(req);

  const userId = await currentUserId(req);
  if (!userId) return jsonError("Not signed in", 401, headers);

  // Both are configuration, not the caller's fault — 503, and said plainly so
  // it shows up as a sentence on the Settings row rather than a dead button.
  if (!process.env.STRAVA_CLIENT_ID) return jsonError("Strava is not configured on this server.", 503, headers);
  const secret = stravaStateSecret();
  if (!secret) {
    console.error("[strava/connect] neither STRAVA_STATE_SECRET nor CRON_SECRET is set — refusing to sign a state.");
    return jsonError("Strava connect is not configured on this server.", 503, headers);
  }

  // The callback is on whichever deployment answered this request, so a
  // preview's connect returns to the preview. (Strava only accepts callbacks
  // on the domain registered for the app, so in practice that is production.)
  const redirectUri = `${new URL(req.url).origin}/api/strava/callback`;
  const url = authorizeUrl(redirectUri, createStravaState(userId, secret));

  return NextResponse.json({ url }, { headers });
}

export const OPTIONS = preflight;

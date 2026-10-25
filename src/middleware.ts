import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie on navigation. Without this a
 * long-lived home-screen PWA silently logs itself out after the access token
 * expires, which is exactly the moment you're standing in a gym.
 */
export async function middleware(request: NextRequest) {
  // A bearer request has no cookies to refresh, and refreshing is a GoTrue
  // round trip — so the native client would pay one on every single API call
  // for nothing. Only requests that actually carry an Authorization header skip
  // it; the web app never sends one, so its refresh behaviour is untouched.
  //
  // The matcher deliberately still covers /api: the PWA can sit on the Lift
  // screen POSTing sets for an hour without a navigation, and that is exactly
  // the session that must not be allowed to expire.
  if (request.headers.has("authorization")) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/).*)"],
};

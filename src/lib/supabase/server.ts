import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { extractBearer, userFromBearer } from "@/lib/auth/bearer";

export async function createClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Called from a Server Component — the middleware refreshes instead.
          }
        },
      },
    },
  );
}

/**
 * A local stand-in for a signed-in user.
 *
 * Magic-link sign-in needs a reachable Supabase, which rules out running the
 * app on a machine that cannot get to one. Setting DEV_USER_ID to a uuid that
 * exists in `profiles` skips the round trip so every screen renders against
 * real local data.
 *
 * Two locks, both required. `next build` sets NODE_ENV=production, so this is
 * dead code in any deployed bundle — a Vercel preview included — and it does
 * nothing at all unless the variable is set explicitly. It is a development
 * affordance, not a feature flag, and it must never become one.
 */
function devUserId(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  const id = process.env.DEV_USER_ID?.trim();
  if (!id) return null;
  if (!warned) {
    console.warn(`[auth] DEV_USER_ID is set — every request is authenticated as ${id}.`);
    warned = true;
  }
  return id;
}
let warned = false;

export interface AuthedUser {
  id: string;
  email: string;
}

/**
 * Who is making this request — cookies for the web, bearer token for native.
 *
 * Pass `req` from an API route; server components call it with nothing, which
 * is the cookie-and-dev-shim path they have always taken.
 *
 * The order is load-bearing:
 *
 *  1. An `Authorization` header present at all means the caller has declared
 *     itself a token client, so the token decides and nothing else gets a vote.
 *     An invalid one returns null — it must 401. Falling through to cookies
 *     here would mean a phone with an expired token quietly authenticating as
 *     whoever happened to be signed in on that origin, and falling through to
 *     the dev shim would turn a typo into a login.
 *  2. DEV_USER_ID, unchanged, for a laptop with no reachable Supabase.
 *  3. Cookies, unchanged, for the web app.
 *
 * Nothing here touches row-level security: the id this returns still goes
 * through `withUser()`, so Postgres does the filtering either way.
 */
export async function currentUser(req?: Request): Promise<AuthedUser | null> {
  const header = req?.headers.get("authorization") ?? null;
  if (header !== null) {
    const token = extractBearer(header);
    if (!token) return null;
    return userFromBearer(token);
  }

  // The shim has no email to offer. Every consumer that needs one is reached
  // by a real session; `ensureProfile` is idempotent and DEV_USER_ID points at
  // a profile that already exists, so there is nothing for it to write.
  const dev = devUserId();
  if (dev) return { id: dev, email: "" };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
}

/** The signed-in user's id, or null. Every data route gates on this. */
export async function currentUserId(req?: Request): Promise<string | null> {
  return (await currentUser(req))?.id ?? null;
}

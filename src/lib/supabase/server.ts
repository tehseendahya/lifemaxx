import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

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

/** The signed-in user's id, or null. Every data route gates on this. */
export async function currentUserId(): Promise<string | null> {
  const dev = devUserId();
  if (dev) return dev;

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/ensure-profile";

/**
 * Only same-origin, path-shaped destinations are allowed.
 *
 * `next` arrives in a URL that lands in the user's inbox, so treating it as a
 * trusted redirect target would turn every password-reset mail into an open
 * redirect — a phishing link that genuinely originates from this app's domain.
 * A leading `//` is rejected too: browsers read `//evil.com` as protocol-
 * relative and would leave the site.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));
  if (!code) return NextResponse.redirect(`${origin}/login`);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(`${origin}/login`);

  // First sign-in creates the profile row the rest of the app hangs off.
  await ensureProfile(data.user.id, data.user.email ?? "");

  return NextResponse.redirect(`${origin}${next}`);
}

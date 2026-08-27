import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/ensure-profile";

/**
 * Called by the login screen once GoTrue has established a session.
 *
 * The id is taken from the verified session, never from the request body —
 * this endpoint writes a row keyed to a user id, and accepting that id from
 * the client would let anyone create or claim a profile that is not theirs.
 */
export async function POST() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  await ensureProfile(data.user.id, data.user.email ?? "");
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/login`);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(`${origin}/login`);

  // First sign-in creates the profile row the rest of the app hangs off.
  const existing = await db.select().from(profiles).where(eq(profiles.id, data.user.id)).limit(1);
  if (existing.length === 0) {
    await db.insert(profiles).values({
      id: data.user.id,
      email: data.user.email ?? "",
    });
  }

  return NextResponse.redirect(origin);
}

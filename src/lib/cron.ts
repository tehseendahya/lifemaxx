import { NextResponse } from "next/server";

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without this check
 * these endpoints are public URLs that spend money on model calls.
 */
export function authorizeCron(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

import { NextResponse } from "next/server";
import { bearerAuthorized } from "./bearer";

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without this check
 * these endpoints are public URLs that spend money on model calls.
 *
 * The comparison itself lives in lib/bearer.ts, because the Health Auto Export
 * webhook needs exactly the same one and a second copy is a second chance to
 * get a constant-time compare subtly wrong.
 */
export const cronAuthorized = bearerAuthorized;

export function authorizeCron(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 500 });
  if (!cronAuthorized(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Day of week for an ISO date (`YYYY-MM-DD`), Sunday = 0.
 *
 * Parsed as UTC deliberately: the string already carries whatever timezone
 * produced it, so re-interpreting it in the server's local zone would shift
 * the day across midnight.
 */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

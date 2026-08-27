import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without this check
 * these endpoints are public URLs that spend money on model calls.
 */
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const expected = `Bearer ${secret}`;
  if (!header || header.length !== expected.length) return false;
  // Constant-time, so the response time cannot be used to walk the secret one
  // character at a time. These are public URLs on the open internet.
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

export function authorizeCron(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 500 });
  if (!cronAuthorized(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

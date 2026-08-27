import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time `Authorization: Bearer <secret>` check.
 *
 * Shared by the cron endpoints and the Health Auto Export webhook. All of them
 * are public URLs on the open internet that write to the database or spend
 * money on model calls, and comparing with `===` leaks the secret one character
 * at a time through response timing.
 */
export function bearerAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const expected = `Bearer ${secret}`;
  if (!header || header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

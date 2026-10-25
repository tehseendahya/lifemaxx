import { HttpError } from "@/lib/api";

/**
 * Conventions every endpoint under /api/mobile holds to, in one place.
 *
 * The phone is coded against these shapes sight-unseen, so the rules are worth
 * stating rather than repeating:
 *
 *  - Weights cross the wire in **lb**, converted with `displayLb`. Storage is
 *    kg and stays kg; the native client never sees a kilogram and therefore
 *    can never convert one twice. Same rule the web edge already follows.
 *  - Dates are `YYYY-MM-DD` local strings, timestamps are ISO 8601 UTC.
 *  - **Primitives only.** A `Date` survives `NextResponse.json` as an ISO
 *    string and comes back as a string on the client, so typing it as a Date
 *    anywhere is a lie that only shows up at runtime. Every timestamp is
 *    stringified explicitly at the boundary.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function requireUuid(value: string | null, field: string): string {
  if (!value || !UUID.test(value)) throw new HttpError(`${field} must be a uuid.`);
  return value;
}

/**
 * A date parameter, or today.
 *
 * The regex is not pedantry: `local_date` is a Postgres `date` column and an
 * unparseable string reaches it as a query error, which `route()` reports as a
 * 500. A caller that sent "yesterday" deserves a 400 that says so.
 */
export function requireLocalDate(value: string | null, fallback: string): string {
  if (value === null || value === "") return fallback;
  if (!LOCAL_DATE.test(value)) throw new HttpError("date must be YYYY-MM-DD.");
  // The shape being right is not the date being real. "2026-13-45" passes the
  // regex and reaches Postgres as a cast error, which `route()` reports as a
  // 500 — so it is round-tripped here, where it can be a 400 instead.
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError("date is not a real date.");
  }
  return value;
}

/** A `limit` query param, clamped. An unbounded limit is a denial of service. */
export function parseLimit(value: string | null, fallback: number, max: number): number {
  if (value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new HttpError("limit must be a positive integer.");
  return Math.min(n, max);
}

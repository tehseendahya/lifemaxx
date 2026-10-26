import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The OAuth `state` for Strava connect, as a signed, short-lived token.
 *
 * The old flow kept a random nonce in an httpOnly cookie and compared it in
 * the callback. That only works when the browser that starts the flow is the
 * browser that finishes it and holds a cookie session — true of the old Next
 * pages, false of the client now. On the phone, "Connect Strava" opens the
 * authorize URL in Safari, which has neither the app's cookie nor its bearer
 * token, so the callback has no way to ask "who is this?".
 *
 * So the state carries the answer itself: `payload.signature`, where the
 * payload names the user, a nonce and an expiry, and the signature is an HMAC
 * only this server can produce. The callback trusts the user id because it
 * verified the signature, not because of anything the request carries.
 *
 * What this does NOT give back is the cookie's browser binding. Someone who
 * starts a connect for their own account could send the resulting authorize
 * link to another person, and if that person approves it their Strava would be
 * attached to the first account. The ten-minute expiry narrows that window; it
 * does not close it. Acceptable for a personal tracker, and the reason the TTL
 * is short rather than generous.
 */

/** Long enough to sign in to Strava and approve; short enough to be useless later. */
export const STRAVA_STATE_TTL_S = 600;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StatePayload {
  /** user id */
  u: string;
  /** nonce: makes every state unique, so two connects never produce the same token */
  n: string;
  /** expiry, unix seconds */
  e: number;
}

/**
 * STRAVA_STATE_SECRET, falling back to CRON_SECRET so a deploy that already has
 * one works without a new variable. Null when neither is set, and callers
 * refuse rather than sign with an empty or guessable key.
 */
export function stravaStateSecret(env: Record<string, string | undefined> = process.env): string | null {
  return env.STRAVA_STATE_SECRET?.trim() || env.CRON_SECRET?.trim() || null;
}

/**
 * The actual HMAC key, derived from the secret for this one purpose.
 *
 * CRON_SECRET is also a bearer credential for the cron endpoints. Deriving a
 * purpose-bound key means a token signed here is meaningless anywhere else the
 * same secret might ever be used to sign something, and vice versa.
 */
function key(secret: string): Buffer {
  return createHmac("sha256", secret).update("lifemaxx:strava-oauth-state:v1").digest();
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", key(secret)).update(payload).digest("base64url");
}

export function createStravaState(
  userId: string,
  secret: string,
  now: number = Date.now(),
): string {
  if (!secret) throw new Error("No secret to sign the Strava state with.");
  if (!UUID.test(userId)) throw new Error("createStravaState needs a user id.");

  const payload: StatePayload = {
    u: userId,
    n: randomBytes(16).toString("base64url"),
    e: Math.floor(now / 1000) + STRAVA_STATE_TTL_S,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

/**
 * The user id a state was issued to, or null for anything not issued by this
 * server with this secret in the last ten minutes.
 *
 * The signature is checked before the payload is parsed, so nothing a caller
 * invents is ever interpreted, and compared in constant time so it cannot be
 * recovered byte by byte from response timing.
 */
export function verifyStravaState(
  state: string | null | undefined,
  secret: string | null,
  now: number = Date.now(),
): string | null {
  if (!state || !secret) return null;

  // Exactly two parts. Destructuring the first two of three would accept a
  // valid state with anything appended to it.
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;

  const expected = Buffer.from(sign(encoded, secret));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as StatePayload;
  } catch {
    return null;
  }

  if (typeof payload?.e !== "number" || payload.e <= Math.floor(now / 1000)) return null;
  if (typeof payload.u !== "string" || !UUID.test(payload.u)) return null;
  return payload.u;
}

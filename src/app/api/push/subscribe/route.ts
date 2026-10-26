import { route, HttpError } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";

interface Body { endpoint: string; keys: { p256dh: string; auth: string } }

/**
 * Store a browser's Web Push subscription — the `PushSubscription.toJSON()`
 * body, as is.
 *
 * Bearer or cookie: `route()` resolves the caller through `currentUser(req)`,
 * which takes an `Authorization: Bearer` header when there is one. That is the
 * path the Expo web client uses (its session lives in localStorage, not a
 * cookie); the cookie path is what the retired Next pages used.
 */
export const POST = route<Body>(async ({ userId, body }) => {
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) throw new HttpError("Invalid subscription.");

  // Upsert, not insert-and-ignore. A browser can hand back an endpoint it has
  // used before with freshly rotated keys, and keeping the old p256dh means
  // every push to that device fails to decrypt — silently, since the push
  // service still returns 201. Re-registering also has to move the endpoint to
  // whoever is signed in now, or a shared device keeps notifying the last user.
  await db.insert(pushSubscriptions).values({
    userId,
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
  }).onConflictDoUpdate({
    target: pushSubscriptions.endpoint,
    set: { userId, p256dh: body.keys.p256dh, auth: body.keys.auth },
  });

  return { ok: true };
});

// Only matters for `npm run dev:web`, where the client is on :8081 and the API
// on :3000. Deployed, the client is same-origin and never preflights.
export const OPTIONS = preflight;

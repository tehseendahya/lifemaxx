import { route } from "@/lib/api";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";

interface Body { endpoint: string; keys: { p256dh: string; auth: string } }

export const POST = route<Body>(async ({ userId, body }) => {
  if (!body.endpoint || !body.keys?.p256dh) throw new Error("Invalid subscription.");

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

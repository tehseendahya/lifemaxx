import { route } from "@/lib/api";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";

interface Body { endpoint: string; keys: { p256dh: string; auth: string } }

export const POST = route<Body>(async ({ userId, body }) => {
  if (!body.endpoint || !body.keys?.p256dh) throw new Error("Invalid subscription.");

  await db.insert(pushSubscriptions).values({
    userId,
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
  }).onConflictDoNothing();

  return { ok: true };
});

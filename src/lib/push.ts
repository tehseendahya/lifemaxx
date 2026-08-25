import webpush from "web-push";
import { db, isScoped, withUser } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";

let configured = false;

function configure(): boolean {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:none@example.com", publicKey, privateKey);
  configured = true;
  return true;
}

/**
 * Sends to every device the user has installed on.
 *
 * Dead endpoints (410/404) are deleted rather than retried — a browser that has
 * revoked a subscription never comes back, and keeping them means every future
 * send burns time on failures.
 */
export async function sendPush(userId: string, payload: { title: string; body: string; url?: string }) {
  if (!configure()) {
    console.warn("[push] VAPID keys not set — skipping.");
    return 0;
  }

  // push_subscriptions is RLS-protected, so this needs a user scope. Callers
  // are a mix — request handlers already have one, crons do not — so enter one
  // only if we are not already inside it.
  const read = () => db.select().from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  const subs = isScoped() ? await read() : await withUser(userId, read);

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
      sent += 1;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        const drop = () => db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        if (isScoped()) await drop(); else await withUser(userId, drop);
      } else {
        console.error("[push] send failed", err);
      }
    }
  }
  return sent;
}

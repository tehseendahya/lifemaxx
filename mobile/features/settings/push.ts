import { apiPost } from "@/lib/api";

import {
  pushPrecheck, subscriptionBody, urlBase64ToUint8Array, type PushState,
} from "./connections";

/**
 * Web push, from the browser. Only ever called on the web: the Connections card
 * renders the notifications row on `Platform.OS === "web"` alone, and nothing
 * here is safe to touch on the phone (there is no `navigator.serviceWorker`).
 *
 * The decisions — what each state means and says — are in `connections.ts`
 * and tested; this file is only the browser calls between them.
 */

/** Read at bundle time: Expo inlines `process.env.EXPO_PUBLIC_*` only when written out in full. */
const VAPID_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** The service worker the server serves at the root; it handles `push` and `notificationclick`. */
const SW_URL = "/sw.js";

function precheck(): PushState | null {
  const nav = navigator as Navigator & { standalone?: boolean };
  return pushPrecheck({
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    vapidKey: VAPID_KEY,
    permission: typeof Notification === "undefined" ? "default" : Notification.permission,
    isIos: /iPad|iPhone|iPod/.test(navigator.userAgent),
    standalone:
      window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true,
  });
}

/** Where push stands in this browser right now. Never throws. */
export async function currentPushState(): Promise<PushState> {
  try {
    const early = precheck();
    if (early !== null) return early;
    // `getRegistration`, not `ready`: `ready` never settles when no worker has
    // been registered yet, which is exactly the first-visit case.
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub && Notification.permission === "granted" ? "on" : "off";
  } catch {
    return "unsupported";
  }
}

/**
 * Register the worker, ask, subscribe, and tell the server.
 *
 * Must run from a click: browsers only show the permission prompt in response
 * to a user gesture. Resolves to the state to show afterwards; throws only for
 * a failure worth a sentence on screen (the server refusing the subscription).
 */
export async function enablePush(): Promise<PushState> {
  const early = precheck();
  if (early !== null) return early;

  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "off";

  const reg = await navigator.serviceWorker.register(SW_URL);
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
    }));

  const body = subscriptionBody(sub.toJSON());
  if (body === null) throw new Error("This browser returned a subscription the server cannot use.");

  // Through the authed helper: the bearer token is how the server knows whose
  // device this is, since the app has no cookie session.
  await apiPost("/api/push/subscribe", body);
  return "on";
}

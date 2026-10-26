/**
 * The Connections card's decisions: Strava and, in a browser, notifications.
 *
 * No `react-native` and no DOM here, so every word the card can show is
 * tested. The browser calls themselves are in `push.ts`; the card is in
 * `ConnectionsCard.tsx`.
 *
 * Both rows code against routes the server owns:
 *  - `POST /api/mobile/strava/connect` (bearer) → `{ url }`, the Strava
 *    authorise URL. The OAuth callback carries the user in a signed `state`,
 *    not in a cookie, so it works when the phone opens the URL in Safari; it
 *    lands on `/you?strava=connected` or `/you?strava=error`.
 *  - `POST /api/push/subscribe` (bearer or cookie) with a `PushSubscription`'s
 *    JSON: `{ endpoint, keys: { p256dh, auth } }`.
 */

export type Tone = "good" | "bad" | "muted";

export interface RowView {
  value: string;
  tone: Tone;
  /** Whether tapping the row does something (connect, enable). */
  actionable: boolean;
}

// -------------------------------------------------------------------- Strava

export function stravaRow(connected: boolean | undefined, busy: boolean): RowView {
  if (busy) return { value: "Opening Strava…", tone: "muted", actionable: false };
  if (connected === true) return { value: "Connected", tone: "good", actionable: false };
  // An older server sends no flag; connecting again is harmless (the callback
  // upserts the tokens), so unknown is offered the same Connect as false.
  // `stravaDetail` is what words the two differently.
  return { value: "Connect", tone: "muted", actionable: true };
}

/** The one-line explainer under the Strava row. */
export function stravaDetail(connected: boolean | undefined): string {
  if (connected === true) return "Runs pull in nightly.";
  if (connected === undefined) return "Runs arrive from Strava once it is connected.";
  return "Not connected. Runs arrive from Strava once it is.";
}

/**
 * What the OAuth round trip says when it lands back on `/you`.
 *
 * Takes the raw search param, which expo-router hands over as a string, an
 * array (a repeated key) or nothing. Anything but the two values the callback
 * sends is ignored, so a hand-typed `?strava=hello` shows nothing.
 */
export function stravaNotice(
  param: string | string[] | undefined,
): { text: string; tone: Tone } | null {
  const value = Array.isArray(param) ? param[0] : param;
  if (value === "connected") return { text: "Strava connected. Runs pull in tonight.", tone: "good" };
  if (value === "error") {
    return { text: "Strava did not connect. Try again — nothing was changed.", tone: "bad" };
  }
  return null;
}

/** The connect route's answer, checked rather than trusted. */
export function connectUrl(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const url = (body as { url?: unknown }).url;
  return typeof url === "string" && /^https:\/\//.test(url) ? url : null;
}

// ------------------------------------------------------------- notifications

/**
 * Where web push stands in this browser.
 *
 *  - `unsupported`: no service worker or no PushManager.
 *  - `install`: iOS Safari, which only delivers push to a home-screen install.
 *  - `unconfigured`: this build has no VAPID public key to subscribe with.
 *  - `blocked`: the user said no; only the browser's site settings can undo it.
 *  - `off` / `on`: whether this browser has a subscription.
 *  - `checking`: not known yet.
 */
export type PushState =
  | "checking" | "unsupported" | "install" | "unconfigured" | "blocked" | "off" | "on";

export interface PushEnvironment {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  vapidKey: string;
  permission: "default" | "granted" | "denied";
  isIos: boolean;
  standalone: boolean;
}

/**
 * Everything that can be decided before asking the service worker whether a
 * subscription exists. `null` means ask: the answer is `on` or `off`.
 */
export function pushPrecheck(env: PushEnvironment): PushState | null {
  if (!env.hasServiceWorker || !env.hasPushManager) return "unsupported";
  if (env.isIos && !env.standalone) return "install";
  if (env.vapidKey.trim() === "") return "unconfigured";
  if (env.permission === "denied") return "blocked";
  return null;
}

export function pushRow(state: PushState, busy: boolean): RowView {
  if (busy) return { value: "Turning on…", tone: "muted", actionable: false };
  switch (state) {
    case "on":
      return { value: "On", tone: "good", actionable: false };
    case "off":
      return { value: "Turn on", tone: "muted", actionable: true };
    case "blocked":
      return { value: "Blocked", tone: "bad", actionable: false };
    case "install":
      return { value: "Install first", tone: "muted", actionable: false };
    case "unconfigured":
      return { value: "Not set up", tone: "muted", actionable: false };
    case "unsupported":
      return { value: "Not supported", tone: "muted", actionable: false };
    case "checking":
      return { value: "Checking…", tone: "muted", actionable: false };
  }
}

export function pushDetail(state: PushState): string {
  switch (state) {
    case "on":
      return "The daily verdict at 9pm, and the weekly review on Sundays.";
    case "off":
      return "The daily verdict at 9pm, and the weekly review on Sundays.";
    case "blocked":
      return "This browser was told no. Allow notifications for this site in its settings.";
    case "install":
      return "iOS only delivers notifications to apps on the home screen. Add this page there first.";
    case "unconfigured":
      return "This build has no push key (EXPO_PUBLIC_VAPID_PUBLIC_KEY).";
    case "unsupported":
      return "This browser cannot receive web push.";
    case "checking":
      return "";
  }
}

/**
 * VAPID keys are base64url; `PushManager.subscribe` wants the raw bytes.
 * Backed by an explicit `ArrayBuffer` so the result is a valid BufferSource.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export interface SubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * The body `POST /api/push/subscribe` accepts, from `PushSubscription.toJSON()`.
 *
 * Checked here because the route refuses a subscription without an endpoint
 * and a p256dh key, and a browser that hands back something else should fail
 * with a sentence on this screen rather than a 500 from the server.
 */
export function subscriptionBody(json: unknown): SubscriptionBody | null {
  if (typeof json !== "object" || json === null) return null;
  const { endpoint, keys } = json as { endpoint?: unknown; keys?: unknown };
  if (typeof endpoint !== "string" || endpoint === "") return null;
  if (typeof keys !== "object" || keys === null) return null;
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  if (typeof p256dh !== "string" || p256dh === "" || typeof auth !== "string" || auth === "") {
    return null;
  }
  return { endpoint, keys: { p256dh, auth } };
}

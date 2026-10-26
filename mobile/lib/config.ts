import { Platform } from "react-native";
import Constants from "expo-constants";
import { rawStore } from "./secure-store";
import { resolveApiBase, webOriginFor } from "./api-base";

/**
 * Where the API lives.
 *
 * Expo Go runs on a real phone, so `localhost` is the phone itself and the
 * deployed API is the only sensible default. But LAN development has to work
 * from the same scanned QR code — rebuilding a bundle to change a hostname is
 * not a workflow — so there are three layers, most specific first:
 *
 *   1. a runtime override the user types in the You screen (SecureStore)
 *   2. `EXPO_PUBLIC_API_BASE_URL`, inlined at bundle time
 *   3. `expo.extra.apiBaseUrl` in app.json
 *   4. web only: the origin the page was served from. The deployed web client
 *      is served by the same Next app as the API, so this is right on
 *      production and every preview with nothing configured — see
 *      `./api-base`, where the rule lives and is tested.
 *
 * Plain HTTP to a LAN address works in Expo Go without an ATS exemption,
 * because Expo Go's own entitlements permit it. `newClientId()` in the shared
 * outbox already has a non-secure-context fallback for exactly this case, so
 * the offline queue keeps minting valid uuids over http://.
 */

const OVERRIDE_KEY = "lifemaxx.apiBase";

function extra(): Record<string, unknown> {
  return (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
}

function trim(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Held in a module variable because every request needs it and nothing can
 * await storage inside a fetch wrapper without making the whole API async in a
 * way that infects every caller. `loadApiBaseOverride()` fills it once at boot,
 * before any request is made.
 */
let override: string | null = null;

const bundled = trim(
  process.env.EXPO_PUBLIC_API_BASE_URL ||
    (typeof extra().apiBaseUrl === "string" ? (extra().apiBaseUrl as string) : ""),
);

/**
 * Read per call rather than captured at load: it is cheap, and `window` does
 * not exist during Expo's static rendering pass. `globalThis.location` rather
 * than `window.location` so native, which has no `window.location`, reads
 * undefined instead of throwing — and `webOriginFor` ignores it there anyway.
 */
function webOrigin(): string | null {
  return webOriginFor(Platform.OS, (globalThis as { location?: { origin?: string } }).location);
}

export function apiBaseUrl(): string {
  return resolveApiBase({ override, bundled, webOrigin: webOrigin() });
}

/**
 * The default with no override, so the You screen can offer "reset to
 * default". On the web that includes the page origin, because that is what
 * resetting actually goes back to.
 */
export function defaultApiBaseUrl(): string {
  return resolveApiBase({ override: null, bundled, webOrigin: webOrigin() });
}

/** True when neither app.json nor the env var was filled in — the UI should say so rather than fail opaquely. */
export function isApiBaseConfigured(): boolean {
  return apiBaseUrl() !== "";
}

export async function setApiBaseOverride(url: string | null): Promise<void> {
  const next = url === null ? null : trim(url);
  override = next === "" ? null : next;

  if (override === null) await rawStore.removeItem(OVERRIDE_KEY);
  else await rawStore.setItem(OVERRIDE_KEY, override);
}

/** Called once from the root layout. A failed read is not fatal — fall back to the bundled URL. */
export async function loadApiBaseOverride(): Promise<void> {
  try {
    const stored = await rawStore.getItem(OVERRIDE_KEY);
    override = stored && stored.trim() !== "" ? trim(stored) : null;
  } catch (err) {
    console.warn("[config] could not read the API base override", err);
    override = null;
  }
}

// ----------------------------------------------------------------- supabase

/**
 * The anon key is designed to ship in clients — the web app already serves it
 * to every browser — so reading it from the bundle is correct, not a leak. Row
 * level security is what actually protects the data, and it is enforced in
 * Postgres regardless of which key reached it.
 */
export function supabaseConfig(): { url: string; anonKey: string } {
  const e = extra();
  return {
    url: (process.env.EXPO_PUBLIC_SUPABASE_URL || (e.supabaseUrl as string) || "").trim(),
    anonKey: (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || (e.supabaseAnonKey as string) || "").trim(),
  };
}

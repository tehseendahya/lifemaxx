// Must come before the Supabase client is constructed. supabase-js builds URLs
// with the WHATWG URL API, which Hermes does not implement; without this the
// first auth call fails with "URL.protocol is not implemented".
import "react-native-url-polyfill/auto";

import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { apiBaseUrl, supabaseConfig } from "./config";
import { chunkedStore } from "./secure-store";

/**
 * Authentication for the native client.
 *
 * Email and password, deliberately. The web app already has it, and it avoids
 * the magic-link deep-link dance entirely — no scheme registration, no
 * association file, no "open in app" interstitial. The session token is then
 * sent to the Next.js API as `Authorization: Bearer <jwt>`, because a native
 * client has no cookies and `createServerClient` would resolve nobody.
 *
 * The server verifies that token with Supabase rather than decoding it locally,
 * and the resolved id still flows through `withUser()`, so row-level security
 * is exactly as it was for the web app.
 */

const { url, anonKey } = supabaseConfig();

/**
 * `createClient` throws on an empty URL, which would crash at import time —
 * before any screen can render, and with a message about `supabaseUrl` that
 * says nothing about the app.json key that is actually missing. Constructing
 * against an unreachable placeholder instead lets the sign-in screen read
 * `isSupabaseConfigured()` and say what to fill in.
 */
const configured = url !== "" && anonKey !== "";

export const supabase: SupabaseClient = createClient(
  configured ? url : "http://127.0.0.1:54321",
  configured ? anonKey : "unconfigured",
  {
    auth: {
      storage: chunkedStore,
      persistSession: true,
      autoRefreshToken: true,
      // There is no URL to detect a session in: this is not a browser and
      // sign-in never happens via a redirect. Leaving it on makes GoTrue poke
      // at `window.location`, which does not exist here.
      detectSessionInUrl: false,
    },
  },
);

export function isSupabaseConfigured(): boolean {
  return configured;
}

export type Session = { userId: string; email: string } | null;

// -------------------------------------------------------------- auto refresh

/**
 * Supabase's refresh timer only runs while the app is in the foreground, and
 * iOS suspends a backgrounded app outright. Without this, the access token
 * expires while the phone is in a pocket and the first request after unlocking
 * — which is the first set of the workout — comes back 401. Re-arming on
 * `active` is what makes the token fresh by the time the gym screen loads.
 */
let appStateWired = false;

function wireAutoRefresh(): void {
  if (appStateWired || !configured) return;
  appStateWired = true;

  const onChange = (next: AppStateStatus) => {
    if (next === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  };

  AppState.addEventListener("change", onChange);
  if (AppState.currentState === "active") supabase.auth.startAutoRefresh();
}

wireAutoRefresh();

// -------------------------------------------------------------------- hook

export function useSession(): { session: Session; loading: boolean } {
  const [session, setSession] = useState<Session>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(toSession(data.session?.user));
      setLoading(false);
    });

    // Fires on sign-in, sign-out and every token refresh, so the gate in the
    // root layout reacts without polling.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(toSession(next?.user));
      setLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return { session, loading };
}

function toSession(user: { id: string; email?: string } | undefined | null): Session {
  return user ? { userId: user.id, email: user.email ?? "" } : null;
}

// ------------------------------------------------------------------ actions

/** GoTrue's messages are reasonable; its casing is not, and a lowercase sentence in the UI reads like a bug. */
function humanise(message: string): string {
  const text = message.trim();
  if (/invalid login credentials/i.test(text)) return "That email and password do not match.";
  if (/email not confirmed/i.test(text)) return "Check your email and confirm the address first.";
  if (/user already registered/i.test(text)) return "There is already an account with that email.";
  if (/password should be at least/i.test(text)) return "Pick a password of at least six characters.";
  if (/network|fetch/i.test(text)) return "Could not reach the server. Check your connection.";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function assertConfigured(): void {
  if (!configured) {
    throw new Error(
      "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, or expo.extra in app.json.",
    );
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  assertConfigured();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw new Error(humanise(error.message));
}

/**
 * Email a password-reset link. `redirectTo` comes from `passwordResetRedirect`
 * in `features/settings/model.ts`; it has to be in the Supabase project's
 * allowed redirect URLs, as the web app's reset already required.
 */
export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  assertConfigured();
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  if (error) throw new Error(humanise(error.message));
}

export async function signUp(email: string, password: string): Promise<void> {
  assertConfigured();
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
  if (error) throw new Error(humanise(error.message));

  // With email confirmation switched on there is no session yet, so there is no
  // token to authenticate the profile call — it happens on first sign-in
  // instead. Nothing to do here but let the screen say "check your email".
  const token = data.session?.access_token;
  if (token) await ensureProfile(token);
}

/**
 * Creates the `profiles` row the rest of the app assumes exists.
 *
 * Called with a plain `fetch` rather than through `./api` on purpose: `api.ts`
 * imports this module for its bearer token, and routing this one call back
 * through it would make that a cycle. A failure here is not fatal — the row is
 * created on the next sign-in — so it warns instead of throwing and blocking
 * an otherwise successful sign-up.
 */
async function ensureProfile(token: string): Promise<void> {
  const base = apiBaseUrl();
  if (base === "") return;

  try {
    await fetch(`${base}/api/auth/ensure-profile`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.warn("[auth] ensure-profile failed; it will be retried on next sign-in", err);
  }
}

export async function signOut(): Promise<void> {
  // `signOut` can reject when the server is unreachable, but the user asked to
  // be signed out and the local session must go regardless — otherwise the app
  // sits in a state where the sign-out button visibly does nothing. `local`
  // clears the stored session without needing the network.
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) console.warn("[auth] sign-out reported an error; the local session was cleared anyway", error);
}

/**
 * The bearer token for an API call, refreshed if it is close to expiring.
 *
 * `getSession()` rather than a cached value: it transparently refreshes an
 * expired token, which is the difference between a 401 on the first set after
 * a long rest and a set that just saves.
 */
export async function accessToken(): Promise<string | null> {
  if (!configured) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch (err) {
    console.warn("[auth] could not read the access token", err);
    return null;
  }
}

/** Signs in with a token obtained elsewhere. Used by the first sign-in's profile bootstrap. */
export async function ensureProfileForCurrentUser(): Promise<void> {
  const token = await accessToken();
  if (token) await ensureProfile(token);
}

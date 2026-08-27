"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "forgot";

export default function Login() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  function switchTo(next: Mode) {
    setMode(next);
    setError(null);
    setSent(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const auth = supabase().auth;

    if (mode === "forgot") {
      // Lands on /auth/callback, which exchanges the recovery code for a
      // session and then forwards to the form that sets the new password.
      const { error } = await auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      setBusy(false);
      if (error) setError(error.message);
      else setSent(true);
      return;
    }

    const { data, error } =
      mode === "signup"
        ? await auth.signUp({ email, password })
        : await auth.signInWithPassword({ email, password });

    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }

    // Email confirmation is off, so a signup returns a session immediately. If
    // that ever changes, GoTrue returns a user with no session instead — say so
    // rather than redirecting to a screen that will bounce straight back here.
    if (!data.session) {
      setBusy(false);
      setError("Check your email to confirm the account, then sign in.");
      return;
    }

    // The profile row is what every screen reads. Password sign-in never passes
    // through /auth/callback, so this is the only place it gets created.
    const res = await fetch("/api/auth/ensure-profile", { method: "POST" });
    if (!res.ok) {
      setBusy(false);
      setError("Signed in, but your profile could not be created. Try again.");
      return;
    }

    // A full load, not a router push: the server components behind / must be
    // rendered with the session cookie the client just set.
    window.location.assign("/");
  }

  const heading =
    mode === "forgot" ? "Reset your password" : mode === "signup" ? "Create an account" : "Lifemaxx";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{heading}</h1>
      <p className="mt-2 text-sm text-muted">
        {mode === "forgot"
          ? "We'll email you a link to set a new one."
          : "Meals, lifts and cardio in one place, with a coach that reads your own data."}
      </p>

      {sent ? (
        <div className="mt-8 rounded-xl border border-line bg-surface p-4">
          <p className="text-sm">
            Check your email for a link to set a new password. It can only be
            used once, and it expires.
          </p>
          <button
            type="button"
            onClick={() => switchTo("signin")}
            className="mt-3 text-sm text-accent"
          >
            Back to sign in
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-3">
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-3 outline-none placeholder:text-muted focus:border-line-strong"
          />
          {mode !== "forgot" && (
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-3 outline-none placeholder:text-muted focus:border-line-strong"
            />
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-accent py-3 font-semibold text-ground transition-opacity active:opacity-70 disabled:opacity-40"
          >
            {busy ? "…" : mode === "forgot" ? "Email me a link" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
          {error && <p className="text-sm text-bad">{error}</p>}
        </form>
      )}

      {!sent && (
        <div className="mt-5 flex flex-col gap-2 text-sm">
          {mode === "signin" && (
            <>
              <button type="button" onClick={() => switchTo("forgot")} className="text-left text-muted underline underline-offset-4 hover:text-ink">
                Forgot your password?
              </button>
              <button type="button" onClick={() => switchTo("signup")} className="text-left text-muted underline underline-offset-4 hover:text-ink">
                No account? Create one
              </button>
            </>
          )}
          {mode !== "signin" && (
            <button type="button" onClick={() => switchTo("signin")} className="text-left text-muted underline underline-offset-4 hover:text-ink">
              Back to sign in
            </button>
          )}
        </div>
      )}

      <p className="mt-10 text-xs text-muted">
        Add to Home Screen after signing in — notifications only work on iOS for
        installed apps, and it gets you the full-screen layout.
      </p>
    </div>
  );
}

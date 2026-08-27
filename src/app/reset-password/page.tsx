"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

/**
 * Where the link in a password-reset email lands.
 *
 * By the time this renders, /auth/callback has already exchanged the recovery
 * code for a session — so the user is signed in and `updateUser` is all that is
 * left. Arriving here without one means the link was already used, expired, or
 * opened in a different browser than it was requested from, and the only useful
 * answer is to send a new one rather than show a form that cannot work.
 */
export default function ResetPassword() {
  const [ready, setReady] = useState<"checking" | "ok" | "no-session">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase().auth.getSession().then(({ data }) =>
      setReady(data.session ? "ok" : "no-session"));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);

    const { error } = await supabase().auth.updateUser({ password });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    // Full load so the server components render with the refreshed session.
    window.location.assign("/");
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center">
      <h1 className="text-3xl font-semibold tracking-tight">Choose a password</h1>

      {ready === "checking" && <p className="mt-4 text-sm text-muted">Checking your link…</p>}

      {ready === "no-session" && (
        <div className="mt-6 rounded-xl border border-line bg-surface p-4">
          <p className="text-sm">
            This reset link is no longer valid. Links expire, and can only be used
            once.
          </p>
          <a href="/login" className="mt-3 inline-block text-sm text-accent">
            Request a new one →
          </a>
        </div>
      )}

      {ready === "ok" && (
        <>
          <p className="mt-2 text-sm text-muted">
            At least 6 characters. You will be signed in straight afterwards.
          </p>
          <form onSubmit={submit} className="mt-6 space-y-3">
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password"
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-3 outline-none placeholder:text-muted"
            />
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat new password"
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-3 outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-accent py-3 font-semibold text-ground disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save password"}
            </button>
            {error && <p className="text-sm text-bad">{error}</p>}
          </form>
        </>
      )}
    </div>
  );
}

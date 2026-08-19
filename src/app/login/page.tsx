"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="flex min-h-dvh flex-col justify-center">
      <h1 className="text-3xl font-semibold tracking-tight">Lifemaxx</h1>
      <p className="mt-2 text-sm text-muted">
        Meals, lifts and cardio in one place, with a coach that reads your own data.
      </p>

      {sent ? (
        <p className="mt-8 rounded-xl border border-line bg-surface p-4 text-sm">
          Check your email — the link signs you in on this device.
        </p>
      ) : (
        <form onSubmit={send} className="mt-8 space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-3 outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-accent py-3 font-semibold text-ground disabled:opacity-40"
          >
            {busy ? "Sending…" : "Email me a link"}
          </button>
          {error && <p className="text-sm text-bad">{error}</p>}
        </form>
      )}

      <p className="mt-8 text-xs text-muted">
        Add to Home Screen after signing in — notifications only work on iOS for
        installed apps, and it gets you the full-screen layout.
      </p>
    </div>
  );
}

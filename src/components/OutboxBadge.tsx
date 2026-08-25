"use client";
import { useEffect, useState } from "react";
import { subscribeToOutbox, flushOutbox, startOutbox, type OutboxState } from "@/lib/outbox";

/**
 * Says out loud whether anything is still on the phone.
 *
 * The alternative — a queue that works silently — is worse than it sounds: the
 * one moment you need to know a set has not reached the server is the moment
 * you are about to close the app and walk out.
 */
export function OutboxBadge() {
  const [state, setState] = useState<OutboxState>({ pending: 0, dropped: [], syncing: false });
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const stop = startOutbox();
    const unsubscribe = subscribeToOutbox(setState);

    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    return () => {
      unsubscribe();
      stop();
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (state.pending === 0 && state.dropped.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs">
      {state.pending > 0 && (
        <div className="flex items-center justify-between gap-3">
          <span className={online ? "text-muted" : "text-warn"}>
            {state.pending} set{state.pending === 1 ? "" : "s"} saved on this phone
            {online ? (state.syncing ? " · syncing…" : " · waiting to sync") : " · no signal"}
          </span>
          {online && !state.syncing && (
            <button onClick={() => void flushOutbox()} className="shrink-0 text-accent">
              Retry
            </button>
          )}
        </div>
      )}
      {state.dropped.length > 0 && (
        <p className="mt-1 text-bad">
          {state.dropped.length} set{state.dropped.length === 1 ? "" : "s"} could not be saved
          {state.dropped[0].lastError ? ` — ${state.dropped[0].lastError}` : ""}. Re-enter{" "}
          {state.dropped.length === 1 ? "it" : "them"}.
        </p>
      )}
    </div>
  );
}

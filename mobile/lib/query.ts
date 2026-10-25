import { AppState } from "react-native";
import { QueryClient, focusManager } from "@tanstack/react-query";

/**
 * Reads only.
 *
 * Writes deliberately do not go through react-query mutations: they go through
 * the outbox, which survives a dead battery and a basement. Routing them
 * through a second mechanism would give the app two different answers to
 * "what happens to this set if the network is gone", and only one of them is
 * the right one.
 *
 * The cache is **not** persisted. That would need another dependency, and it
 * is not how offline reads work here — the phone gets everything from one
 * `bootstrap` call and holds it in memory for the session.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Long enough that switching tabs is instant, short enough that a set
      // logged on the Lift tab shows up on Today without a manual pull.
      staleTime: 30_000,
      // One retry, not three. In a gym the second attempt usually fails for the
      // same reason as the first, and a stale dashboard beats a spinner.
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

/**
 * `refetchOnWindowFocus` does nothing on a phone until this runs.
 *
 * react-query's focus manager listens for a DOM `visibilitychange` event, and
 * nothing in React Native dispatches one — so the flag above was inert.
 * Combined with expo-router keeping tab screens mounted after their first
 * visit (no remount, therefore no refetch) and no `refetchInterval` anywhere,
 * Today would sit on an hour-old payload until the user thought to pull down.
 *
 * `active` only. `inactive` is the app switcher and a half-swiped notification
 * shade, which are not the user leaving; treating them as a blur and then as a
 * focus would fire a refetch every time somebody peeked at a message.
 *
 * Called once from the root layout rather than at module scope: a subscription
 * created as an import side effect is one nothing can ever remove, which in a
 * Fast Refresh session means a new listener on every save.
 */
export function startFocusTracking(): () => void {
  const sub = AppState.addEventListener("change", (status) => {
    focusManager.setFocused(status === "active");
  });
  return () => sub.remove();
}

export const queryKeys = {
  bootstrap: ["bootstrap"] as const,
  session: ["session"] as const,
  food: (date: string) => ["food", date] as const,
  exercise: (id: string) => ["exercise", id] as const,
  coach: ["coach"] as const,
};

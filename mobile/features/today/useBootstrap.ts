import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";

import { apiGet } from "@/lib/api";
import { useOutbox } from "@/lib/outbox";
import { queryKeys } from "@/lib/query";
import type { Bootstrap } from "@/lib/types";

/**
 * The one read behind both the Today screen and the Runs screen.
 *
 * It lives in `features/today` because Today owns the request and Runs is
 * pushed from inside the Today tab — both are looking at the same cache entry,
 * and `GET /api/mobile/bootstrap` is deliberately one fat call so that a phone
 * walking into a basement has the whole dashboard after a single round trip.
 * Two hooks would mean two query keys and two requests for the same payload.
 *
 * Nothing here throws on a failed refetch and nothing blocks on a spinner once
 * there is data: react-query keeps the last successful payload while a refetch
 * fails, so a stale dashboard with no signal is the normal, correct state. The
 * screens only show an error when there is genuinely nothing cached to show.
 */
export interface BootstrapView {
  data: Bootstrap | undefined;
  /** True only on the very first load, when there is nothing cached to render. */
  loading: boolean;
  /** Set only when there is no cached payload at all — never for a failed refetch. */
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  retry: () => void;
}

export function useBootstrap(): BootstrapView {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => apiGet<Bootstrap>("/api/mobile/bootstrap"),
  });

  const { refetch } = query;

  /*
   * The pull-to-refresh spinner is driven by local state rather than by
   * `isRefetching`, which is also true for the focus refetch and the outbox
   * drain. Binding the control to that would make it spin on its own every
   * time the user came back to the tab, which reads as the app doing something
   * it was not asked to do.
   */
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refetch().finally(() => setRefreshing(false));
  }, [refetch]);

  /*
   * Refetch when the outbox drains. A session logged in a basement is written
   * to SQLite and delivered when signal returns; without this the dashboard
   * keeps showing the pre-basement numbers until the user thinks to pull, and
   * "I logged that and it did not count" is exactly the impression to avoid.
   *
   * Watching the pending count fall to zero rather than hooking delivery
   * itself keeps this screen out of the outbox's internals. Both screens can be
   * mounted at once (Runs pushes over Today), so this can fire twice — harmless,
   * because react-query collapses concurrent fetches of one key into one
   * request.
   */
  /*
   * Refetch when the screen comes back into focus, but only if the payload has
   * actually gone stale.
   *
   * `queryClient` sets `refetchOnWindowFocus: true`, and that does nothing on a
   * phone: react-query's focus manager listens for a DOM `visibilitychange`,
   * and nothing bridges React Native's `AppState` to it. Tab screens also stay
   * mounted once visited, so there is no remount to trigger a refetch either —
   * without this, Today could sit on the numbers it loaded an hour ago until
   * the user thought to pull down.
   *
   * `stale: true` is what keeps this from firing a request on every single tab
   * switch: it refetches only what `staleTime` has already marked stale, so the
   * 30-second window configured in one place stays configured in one place.
   */
  useFocusEffect(useCallback(() => {
    void client.refetchQueries({ queryKey: queryKeys.bootstrap, type: "active", stale: true });
  }, [client]));

  const { pending } = useOutbox();
  const previousPending = useRef(pending);
  useEffect(() => {
    const drained = previousPending.current > 0 && pending === 0;
    previousPending.current = pending;
    if (drained) void client.invalidateQueries({ queryKey: queryKeys.bootstrap });
  }, [pending, client]);

  return {
    data: query.data,
    loading: query.isPending,
    error: query.data === undefined && query.error ? query.error.message : null,
    refreshing,
    onRefresh,
    retry: () => { void refetch(); },
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";

import { apiGet, apiPost } from "@/lib/api";
import { useOutbox } from "@/lib/outbox";
import { queryKeys } from "@/lib/query";
import { deviceTimezone, timezoneToReport } from "@/lib/timezone";
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

  /*
   * Tell the server where the phone is, the first time it disagrees.
   *
   * `profiles.tz` decides what `localDate()` calls today, and nothing had ever
   * written to it — every account sat on the `America/New_York` schema default,
   * so every date in the app was a New York date. This is the one place that
   * can fix it without asking the owner anything: bootstrap already reports
   * what the server holds, and the phone already knows the truth.
   *
   * It hangs off bootstrap rather than off sign-in because it has to re-run
   * after travel, and bootstrap is the call that happens on every launch and
   * every focus.
   *
   * `reported` is the loop guard, and it is load-bearing. The success path
   * terminates on its own — the write makes the two agree, so the next payload
   * reports nothing to do — but the FAILURE path does not: a zone the server
   * refuses as unusable leaves the column unchanged, so the next bootstrap
   * would disagree again and post again, forever. One attempt per zone per
   * launch, whatever the outcome.
   */
  const serverTz = query.data?.tz;
  const reported = useRef<string | null>(null);
  useEffect(() => {
    const tz = timezoneToReport(deviceTimezone(), serverTz);
    if (tz === null || reported.current === tz) return;

    reported.current = tz;
    void apiPost("/api/profile", { tz })
      .then(() => {
        // `today` is computed server-side from this, so everything derived
        // from it is now wrong in the cache — including which day the
        // dashboard thinks it is showing.
        void client.invalidateQueries({ queryKey: queryKeys.bootstrap });
      })
      .catch((err: unknown) => {
        // Not surfaced. The dates stay as they were, which is the state the
        // app has been in all along, and nothing the owner can do about it
        // belongs in front of them mid-session.
        console.warn("[today] could not report the timezone", err);
      });
  }, [serverTz, client]);

  return {
    data: query.data,
    loading: query.isPending,
    error: query.data === undefined && query.error ? query.error.message : null,
    refreshing,
    onRefresh,
    retry: () => { void refetch(); },
  };
}

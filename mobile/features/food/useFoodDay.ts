import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";

import { queryKeys } from "@/lib/query";
import type { FoodDay } from "@/lib/types";

import { fetchFoodDay } from "./requests";
import { shiftIsoDate } from "./model";

/**
 * The day the Food screen is showing, and the stepper that moves it.
 *
 * `selected === null` means today, and that is not the same as "the ISO date
 * that happens to be today". The server owns the day boundary (the profile
 * timezone lives there), so today is requested with no `date` parameter at all
 * and the response tells us what today was. One consequence worth knowing: the
 * cache key for today is `food("")`, not `food("2026-10-25")`, so there is
 * exactly one cache entry per day and stepping back to today reuses the entry
 * the screen loaded with instead of fetching the same day under a second key.
 */
export interface FoodDayView {
  data: FoodDay | undefined;
  /** True only on a first load with nothing cached to render. */
  loading: boolean;
  /** Set only when there is no cached payload at all — never for a failed refetch. */
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  retry: () => void;

  /** `null` until the first successful load tells us what the server calls today. */
  today: string | null;
  /** `null` means today. Pass this as `localDate` when saving; omit it when null. */
  selected: string | null;
  /** What the header shows: the selected date, or today once it is known. */
  shown: string | null;
  canStepBack: boolean;
  canStepForward: boolean;
  stepBack: () => void;
  stepForward: () => void;

  /** Called after a write to the day on screen. */
  invalidateDay: () => void;
  /** Called after a write that lands on today regardless of what is on screen. */
  invalidateToday: () => void;
}

export function useFoodDay(): FoodDayView {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.food(selected ?? ""),
    queryFn: () => fetchFoodDay(selected),
  });

  const { refetch } = query;

  /*
   * Today's date, read out of the cache rather than held in state.
   *
   * The screen always mounts on today, so the `food("")` entry is populated by
   * the first load and stays populated for the life of the cache — by the time
   * the stepper can be pressed, this has an answer. Reading it here rather than
   * mirroring it into `useState` avoids a second render pass and avoids the
   * stale copy that a mirror eventually becomes. `getQueryData` is not
   * reactive, but it does not need to be: the render that resolves the first
   * query is the render that fills it in.
   */
  const today = client.getQueryData<FoodDay>(queryKeys.food(""))?.date ?? null;

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refetch().finally(() => setRefreshing(false));
  }, [refetch]);

  /*
   * Refetch on focus when the payload has gone stale.
   *
   * `queryClient` sets `refetchOnWindowFocus: true` and that does nothing on a
   * phone — react-query's focus manager listens for a DOM `visibilitychange`
   * and nothing bridges React Native's `AppState` to it. Tab screens also stay
   * mounted once visited, so there is no remount to lean on either. `stale:
   * true` is what keeps this from firing on every tab switch: the 30-second
   * window configured in `lib/query.ts` stays the only place it is configured.
   */
  useFocusEffect(useCallback(() => {
    void client.refetchQueries({ queryKey: queryKeys.food(selected ?? ""), type: "active", stale: true });
  }, [client, selected]));

  const invalidateDay = useCallback(() => {
    void client.invalidateQueries({ queryKey: queryKeys.food(selected ?? "") });
    /*
     * Today's fuel card is the first thing on the landing screen and it reads
     * the same meals from `bootstrap`. Without this, logging a meal and
     * switching to Today shows the pre-meal number for up to the staleTime,
     * which reads as "it didn't count" — the one impression a food logger must
     * never give.
     */
    void client.invalidateQueries({ queryKey: queryKeys.bootstrap });
  }, [client, selected]);

  const invalidateToday = useCallback(() => {
    void client.invalidateQueries({ queryKey: queryKeys.food("") });
    void client.invalidateQueries({ queryKey: queryKeys.bootstrap });
  }, [client]);

  const shown = selected ?? today;

  return {
    data: query.data,
    loading: query.isPending,
    error: query.data === undefined && query.error ? query.error.message : null,
    refreshing,
    onRefresh,
    retry: () => { void refetch(); },

    today,
    selected,
    shown,

    // Stepping needs to know what today is, so that forward can be stopped at
    // it. Until the first load lands, neither direction is offered rather than
    // offering one that might walk into the future.
    canStepBack: today !== null,
    canStepForward: selected !== null,

    invalidateDay,
    invalidateToday,

    stepBack: useCallback(() => {
      setSelected((current) => {
        const from = current ?? today;
        return from === null ? null : shiftIsoDate(from, -1);
      });
    }, [today]),

    /**
     * Forward stops at today: a future day has no meals and no target, and
     * `POST /api/meals` would happily accept a `localDate` in it.
     */
    stepForward: useCallback(() => {
      setSelected((current) => {
        if (current === null || today === null) return null;
        const next = shiftIsoDate(current, 1);
        return next === today ? null : next;
      });
    }, [today]),
  };
}

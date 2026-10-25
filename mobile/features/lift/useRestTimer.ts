import { useCallback, useEffect, useRef, useState } from "react";

import { tapDone } from "@/lib/haptics";
import { REST_DEFAULT_S } from "./logic";

export interface RestTimer {
  /** Seconds left, or `null` when no timer is running. */
  remainingS: number | null;
  /** True for two seconds after the timer reaches zero, so the bar can flash. */
  done: boolean;
  /** Fraction elapsed, 0 → 1. For the bar's width. */
  progress: number;
  start: () => void;
  dismiss: () => void;
}

/**
 * The rest timer, which is a bar and not an event.
 *
 * It is driven from an absolute end timestamp rather than by decrementing a
 * counter, because `setInterval` in React Native is throttled while the app is
 * backgrounded and does not fire at all while it is suspended. A decrementing
 * counter would come back from a pocket showing 1:58 of a two-minute rest that
 * actually finished ninety seconds ago. Comparing against a deadline is right
 * whatever the interval did.
 *
 * Deliberately not an `expo-notifications` alarm: notifications are out of
 * scope for Expo Go, and a backgrounded Expo Go app will not reliably fire one.
 * A timer that lies about going off is worse than a bar you have to look at.
 */
export function useRestTimer(durationS: number = REST_DEFAULT_S): RestTimer {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [done, setDone] = useState(false);

  // Latched so the completion haptic fires once per rest, not once per tick
  // after the deadline passes.
  const fired = useRef(false);

  useEffect(() => {
    if (endsAt === null) return;

    // Half-second ticks: the label is whole seconds, and a one-second interval
    // visibly skips a number when its phase drifts against the deadline.
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [endsAt]);

  useEffect(() => {
    if (endsAt === null || now < endsAt) return;
    if (fired.current) return;

    fired.current = true;
    tapDone();
    setDone(true);
    setEndsAt(null);

    const t = setTimeout(() => setDone(false), 2_000);
    return () => clearTimeout(t);
  }, [endsAt, now]);

  const start = useCallback(() => {
    fired.current = false;
    setDone(false);
    setNow(Date.now());
    setEndsAt(Date.now() + durationS * 1_000);
  }, [durationS]);

  const dismiss = useCallback(() => {
    fired.current = true;
    setEndsAt(null);
    setDone(false);
  }, []);

  const remainingS = endsAt === null ? null : Math.max(0, (endsAt - now) / 1_000);

  return {
    remainingS,
    done,
    progress: remainingS === null ? 0 : 1 - remainingS / durationS,
    start,
    dismiss,
  };
}

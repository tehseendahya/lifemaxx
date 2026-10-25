import { useCallback, useRef, useState } from "react";

import { apiPost } from "@/lib/api";
import type { SuggestPair } from "./logic";

export interface Suggestions {
  get: (exerciseId: string) => SuggestPair | null;
  /** Fire-and-forget. Safe to call on every page change; it de-duplicates itself. */
  request: (exerciseId: string) => void;
}

/**
 * `POST /api/session/suggest`, as an advisory.
 *
 * Everything about this is subordinate to one rule: **a failed suggestion must
 * never affect logging.** There is no loading state, no error state and no
 * retry. If the call comes back, two extra lines appear under the hero button —
 * the mechanical baseline next to the model's number, the way the web app shows
 * them, so a deviation is visible and attributable. If it does not come back,
 * the card is exactly what it was.
 *
 * Requested once per exercise per mount. The endpoint reads the session so far,
 * so its answer does change as sets are logged — but re-asking after every set
 * would mean a model call per tap, and the number it is advising on is already
 * on the button. Asking once when the page is reached is the right trade.
 */
export function useSuggestions(): Suggestions {
  const [pairs, setPairs] = useState<Record<string, SuggestPair>>({});
  const asked = useRef(new Set<string>());

  const request = useCallback((exerciseId: string) => {
    if (exerciseId === "" || asked.current.has(exerciseId)) return;
    asked.current.add(exerciseId);

    void (async () => {
      try {
        const pair = await apiPost<SuggestPair>("/api/session/suggest", { exerciseId });
        // `baseline` is the one field the route always returns. Anything else
        // is a shape this build does not understand, and rendering half of it
        // under a button the user is about to press is worse than rendering
        // nothing.
        if (pair?.baseline === undefined) return;
        setPairs((current) => ({ ...current, [exerciseId]: pair }));
      } catch {
        // Offline, a cold start that timed out, or a model that declined.
        // Allowed to be asked again on the next mount, not on the next render.
        asked.current.delete(exerciseId);
      }
    })();
  }, []);

  const get = useCallback((exerciseId: string) => pairs[exerciseId] ?? null, [pairs]);

  return { get, request };
}

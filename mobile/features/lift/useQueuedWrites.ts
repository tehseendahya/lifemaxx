import { useEffect, useMemo, useState } from "react";

import { pendingItems, useOutbox } from "@/lib/outbox";
import type { OutboxItem } from "@/lib/shared/outbox";
import { findQueuedStart, queuedSetCount, queuedSetFromItem, type LocalSet } from "./logic";

export interface QueuedWrites {
  /** Queued sets, readable and drawable. Malformed payloads are left out. */
  sets: LocalSet[];
  /** The outbox id of each queued set, so a long-press can abandon one. */
  idOf: (clientId: string) => string | null;
  /** How many sets are waiting. Drives the `3 QUEUED` pill. */
  setCount: number;
  /** Epoch ms of a queued, undelivered session start. */
  queuedStartAt: number | null;
  /** Items abandoned since launch, so the screen can say a set did not save. */
  dropped: OutboxItem[];
  syncing: boolean;
  /** Rises on every enqueue and every delivery — the edge the session refetches on. */
  pending: number;
}

/**
 * The outbox, as the live session needs to see it.
 *
 * The queue is the session's durable optimistic state, not a side channel: a
 * set that has been queued but not delivered is a set the user did, and it has
 * to be on screen after the app is killed and relaunched in the same gym. So
 * the pills are drawn from here rather than from a React-only list, and the
 * only thing React state adds on top is the few milliseconds between the press
 * and the SQLite write publishing.
 *
 * `pendingItems()` is async, so it is re-read whenever the outbox publishes —
 * which it does on every enqueue, every delivery and every flush. Re-reading on
 * `syncing` as well as on `pending` matters: a flush that delivers one set and
 * then blocks on the next leaves `pending` unchanged at the start and end of
 * the flush, and only the `syncing` transition reveals that the list moved.
 */
export function useQueuedWrites(): QueuedWrites {
  const { pending, dropped, syncing } = useOutbox();
  const [items, setItems] = useState<OutboxItem[]>([]);

  useEffect(() => {
    let alive = true;
    void pendingItems()
      .then((next) => {
        if (alive) setItems(next);
      })
      .catch(() => {
        // A queue that cannot be read is not a reason to take the session off
        // the screen. The sets are still in SQLite and still being delivered;
        // only the optimistic redraw is lost, and `enqueue` already returned.
      });
    return () => {
      alive = false;
    };
  }, [pending, syncing]);

  // Memoised on `items`, which only changes when the outbox publishes. Without
  // it, `sets` would be a new array on every render of the session screen —
  // including every tick of the elapsed clock — and the merge that depends on
  // it would re-sort the whole session each time.
  const derived = useMemo(() => {
    const sets: LocalSet[] = [];
    const ids = new Map<string, string>();

    for (const item of items) {
      const set = queuedSetFromItem(item);
      if (set === null) continue;
      sets.push(set);
      ids.set(set.clientId, item.id);
    }

    const start = findQueuedStart(items);

    return {
      sets,
      ids,
      setCount: queuedSetCount(items),
      queuedStartAt: start === null ? null : start.createdAt,
    };
  }, [items]);

  return {
    sets: derived.sets,
    idOf: (clientId) => derived.ids.get(clientId) ?? null,
    setCount: derived.setCount,
    queuedStartAt: derived.queuedStartAt,
    dropped,
    syncing,
    pending,
  };
}

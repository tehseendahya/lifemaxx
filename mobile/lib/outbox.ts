import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import * as SQLite from "expo-sqlite";
import * as Network from "expo-network";

import {
  flush, memoryStore, classifyStatus, newClientId,
  type FlushResult, type OutboxItem, type OutboxKind, type OutboxStore, type Send,
} from "./shared/outbox";
import {
  CREATE_TABLE, createSqliteStore, dropStaleStarts,
} from "./outbox-store";
import { apiBaseUrl } from "./config";
import { accessToken } from "./auth";

export {
  CREATE_TABLE, createSqliteStore, dropStaleStarts, rowToItem,
  MAX_SESSION_START_AGE_MS, type BindValue, type OutboxRow, type SqliteLike,
} from "./outbox-store";

/**
 * The native half of the outbox.
 *
 * The delivery rules — strictly in order, stop at the first failure, only retry
 * what retrying can fix, give up after `MAX_ATTEMPTS` — are **not** in this
 * file. They live in `src/lib/outbox/queue.ts`, are shared with the web app and
 * are the one part of this system with real test coverage. This file is three
 * things and nothing more: a SQLite table, a fetch, and the triggers that fire
 * a flush.
 *
 * A set save writes to SQLite and returns immediately. It never waits on a
 * network that, in the room where this app is used, is usually not there.
 */

// ------------------------------------------------------------------- store

/**
 * Opened once, lazily.
 *
 * SQLite rather than AsyncStorage because the queue needs durable, ordered
 * rows, and rather than react-native-mmkv because MMKV requires a prebuild and
 * this app has to run in Expo Go.
 *
 * The memory fallback means a failure to open degrades to "the queue lives as
 * long as the app does" rather than a save button that throws — which, mid-set,
 * is the worse outcome by a wide margin.
 */
let storePromise: Promise<OutboxStore> | null = null;

function getStore(): Promise<OutboxStore> {
  if (storePromise) return storePromise;

  storePromise = (async () => {
    try {
      const db = await SQLite.openDatabaseAsync("lifemaxx.db");
      await db.execAsync(CREATE_TABLE);
      return createSqliteStore(db);
    } catch (err) {
      console.warn("[outbox] SQLite unavailable — queueing in memory for this launch only.", err);
      return memoryStore();
    }
  })();

  return storePromise;
}

// ---------------------------------------------------------------- delivery

const send: Send = async (item) => {
  const token = await accessToken();
  const base = apiBaseUrl();

  // The base URL is resolved at delivery time, not at enqueue time. The user
  // can repoint the app at a LAN dev server from the You screen while sets are
  // already queued, and those sets should go to the server that is actually
  // there.
  if (base === "") return { status: "retry", error: "no API URL configured" };

  let res: Response;
  try {
    res = await fetch(`${base}${item.url}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(item.payload),
    });
  } catch (err) {
    // No response at all: no signal, DNS, a connection dropped mid-flight.
    return { status: "retry", error: err instanceof Error ? err.message : "network error" };
  }

  const verdict = classifyStatus(res.status);
  if (verdict === "ok") return { status: "ok" };

  const body = await res.text().catch(() => "");
  return { status: verdict, error: `${res.status} ${body.slice(0, 200)}` };
};

// -------------------------------------------------------------- subscribers

export interface OutboxState {
  pending: number;
  /** Items abandoned as undeliverable since launch. Surfaced so the UI can say so. */
  dropped: OutboxItem[];
  syncing: boolean;
}

type Listener = (state: OutboxState) => void;

let state: OutboxState = { pending: 0, dropped: [], syncing: false };
const listeners = new Set<Listener>();

function publish(next: Partial<OutboxState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}

export function subscribeToOutbox(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => { listeners.delete(listener); };
}

export const outboxState = (): OutboxState => state;

/**
 * React's view of the queue. Drives the pending badge and the "N sets waiting"
 * line, and tells the dashboards when to refetch.
 */
export function useOutbox(): OutboxState {
  const [current, setCurrent] = useState<OutboxState>(state);
  useEffect(() => subscribeToOutbox(setCurrent), []);
  return current;
}

// ------------------------------------------------------------------- public

/**
 * Queues a write and kicks off delivery without waiting for it.
 *
 * The returned id is also the row's `client_id`: `POST /api/sets` upserts on
 * `(workout_id, client_id)`, so a retry after a response that was lost in
 * transit is recognised as the same set rather than written twice.
 */
export async function enqueue(
  kind: OutboxKind,
  url: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const id = (payload.clientId as string | undefined) ?? newClientId();

  const item: OutboxItem = {
    id,
    kind,
    url,
    // `loggedAt` is stamped here rather than on arrival. A set logged at 6:12pm
    // in a basement and delivered at 7:04pm in the car park happened at 6:12 —
    // and the server derives `rest_s` from the gap between consecutive
    // `loggedAt` values, so arrival time would put every rest gap in the
    // session in the wrong place.
    // Preserved, not re-stamped: SessionScreen's RETRY re-enqueues a dropped
    // item's original payload, and overwriting this would file the set at the
    // retry time. The server derives rest_s from the gap between consecutive
    // loggedAt values, so a set retried forty minutes later would record a
    // forty-minute rest and sit in the wrong place in the session.
    payload: {
      ...payload,
      clientId: id,
      loggedAt: (payload.loggedAt as string | undefined) ?? new Date().toISOString(),
    },
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
  };

  const store = await getStore();
  await store.put(item);
  publish({ pending: (await store.all()).length });

  void flushOutbox();
  return id;
}

let inFlight: Promise<FlushResult> | null = null;

/** Delivers whatever is queued. Safe to call from anywhere, as often as you like. */
export function flushOutbox(): Promise<FlushResult> {
  if (inFlight) return inFlight;

  publish({ syncing: true });

  inFlight = (async () => {
    try {
      // Signed out: do not attempt at all. An attempt would post with no
      // Authorization header, come back 401, and burn one of the item's eight
      // attempts for a reason that has nothing to do with the item. Eight of
      // those inside a few minutes and a basement's worth of sets is gone.
      // Holding the queue costs nothing — it drains on the next flush after
      // sign-in, and startOutbox() flushes every 30s regardless of session.
      if ((await accessToken()) === null) {
        const held = (await (await getStore()).all()).length;
        publish({ pending: held, syncing: false });
        return { sent: 0, dropped: [], remaining: held, blocked: true };
      }

      const store = await getStore();
      const stale = await dropStaleStarts(store, Date.now());
      const result = await flush(store, send);
      const pending = (await store.all()).length;

      const dropped = [...stale, ...result.dropped];
      publish({
        pending,
        syncing: false,
        dropped: dropped.length > 0 ? [...state.dropped, ...dropped] : state.dropped,
      });

      return { ...result, dropped, remaining: pending };
    } catch (err) {
      console.error("[outbox] flush failed", err);
      publish({ syncing: false });
      return { sent: 0, dropped: [], remaining: state.pending, blocked: true };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** What is still waiting, oldest first. For the "pending" list in the UI. */
export async function pendingItems(): Promise<OutboxItem[]> {
  return (await getStore()).all();
}

/** Abandons one queued item — the escape hatch for a write the user no longer wants. */
export async function removeQueued(id: string): Promise<void> {
  const store = await getStore();
  await store.remove(id);
  publish({ pending: (await store.all()).length });
}

// ------------------------------------------------------------------ triggers

let runners = 0;
let teardown: (() => void) | null = null;

/**
 * Wires the three triggers that actually fire on a phone.
 *
 * Foreground is the one that matters: iOS suspends a backgrounded app outright,
 * so there is no background retry to rely on and the flush that delivers a
 * basement's worth of sets is the one that runs when the app comes back. The
 * 30-second interval covers the case where the app stays open as signal
 * returns, and `expo-network` covers walking out of the basement with the
 * screen on.
 *
 * Reference-counted so several components may call it.
 */
export function startOutbox(): () => void {
  runners += 1;

  if (!teardown) {
    const onAppState = (next: AppStateStatus) => {
      if (next === "active") void flushOutbox();
    };

    const appState = AppState.addEventListener("change", onAppState);
    const timer = setInterval(() => void flushOutbox(), 30_000);

    const network = Network.addNetworkStateListener((networkState) => {
      if (networkState.isInternetReachable) void flushOutbox();
    });

    teardown = () => {
      appState.remove();
      network.remove();
      clearInterval(timer);
    };

    // Publish the count before the first flush, so a queue left over from a
    // previous launch is visible immediately rather than only after delivery
    // succeeds or fails.
    void (async () => {
      try {
        publish({ pending: (await pendingItems()).length });
      } catch (err) {
        console.warn("[outbox] could not read the queue at boot", err);
      }
      await flushOutbox();
    })();
  }

  return () => {
    runners -= 1;
    if (runners <= 0) {
      runners = 0;
      teardown?.();
      teardown = null;
    }
  };
}

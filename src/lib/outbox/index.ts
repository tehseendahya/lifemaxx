"use client";
import Dexie, { type Table } from "dexie";
import {
  flush, memoryStore, classifyStatus,
  type OutboxItem, type OutboxStore, type Send, type FlushResult,
} from "./queue";

export * from "./queue";

/**
 * The browser half of the outbox.
 *
 * A set save writes to IndexedDB first and returns immediately, so the UI never
 * waits on a network that may not be there. Delivery happens in the background
 * and resumes on its own when signal comes back — which in a gym basement is
 * usually when you walk out to the car park, forty minutes and eleven sets
 * later.
 *
 * The queue logic lives in ./queue and is storage-agnostic; this file is the
 * Dexie table, the fetch, and the triggers.
 */

class OutboxDb extends Dexie {
  items!: Table<OutboxItem, string>;

  constructor() {
    super("lifemaxx-outbox");
    this.version(1).stores({ items: "id, createdAt" });
  }
}

function dexieStore(): OutboxStore {
  const db = new OutboxDb();
  return {
    all: () => db.items.toArray(),
    put: async (item) => { await db.items.put(item); },
    remove: async (id) => { await db.items.delete(id); },
  };
}

/**
 * Private browsing, a locked-down browser, or an iOS storage eviction can all
 * make IndexedDB throw on open. Falling back to memory keeps the session
 * working for as long as the tab lives, which is strictly better than a set
 * button that throws.
 */
let store: OutboxStore | null = null;
function getStore(): OutboxStore {
  if (store) return store;
  try {
    store = dexieStore();
  } catch {
    console.warn("[outbox] IndexedDB unavailable — queueing in memory for this tab only.");
    store = memoryStore();
  }
  return store;
}

const send: Send = async (item) => {
  let res: Response;
  try {
    res = await fetch(item.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item.payload),
    });
  } catch (err) {
    // No response at all: offline, DNS, a dropped connection mid-flight.
    return { status: "retry", error: err instanceof Error ? err.message : "network error" };
  }

  const verdict = classifyStatus(res.status);
  if (verdict === "ok") return { status: "ok" };

  const body = await res.text().catch(() => "");
  return { status: verdict, error: `${res.status} ${body.slice(0, 200)}` };
};

// --------------------------------------------------------------- subscribers

type Listener = (state: OutboxState) => void;

export interface OutboxState {
  pending: number;
  /** Items abandoned as undeliverable since the page loaded. */
  dropped: OutboxItem[];
  syncing: boolean;
}

let state: OutboxState = { pending: 0, dropped: [], syncing: false };
const listeners = new Set<Listener>();

function publish(next: Partial<OutboxState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}

export function subscribeToOutbox(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => { listeners.delete(listener); };
}

export const outboxState = (): OutboxState => state;

// --------------------------------------------------------------- public API

export function newClientId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * Queues a set and kicks off delivery without waiting for it.
 *
 * Returns the client id, which is also the row's `client_id` — so a retry after
 * a lost response is recognised by the server as the same set rather than
 * written twice.
 */
export async function enqueueSet(payload: Record<string, unknown>): Promise<string> {
  const id = (payload.clientId as string | undefined) ?? newClientId();
  const item: OutboxItem = {
    id,
    kind: "set",
    url: "/api/sets",
    // loggedAt is stamped here, not on arrival. A set logged at 6:12pm and
    // delivered at 7:04pm happened at 6:12, and the rest gap between it and the
    // set before it is measured from that, not from when signal came back.
    payload: { ...payload, clientId: id, loggedAt: new Date().toISOString() },
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
  };

  await getStore().put(item);
  publish({ pending: state.pending + 1 });
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
      const result = await flush(getStore(), send);
      const pending = (await getStore().all()).length;
      publish({
        pending,
        syncing: false,
        dropped: result.dropped.length ? [...state.dropped, ...result.dropped] : state.dropped,
      });
      return result;
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

/** How many sets are still waiting to reach the server. */
export async function pendingCount(): Promise<number> {
  return (await getStore().all()).length;
}

let runners = 0;
let teardown: (() => void) | null = null;

/**
 * Wires the triggers that matter on a phone: coming back online, and coming
 * back to the tab — which on iOS is the one that actually fires, because the
 * OS suspends a backgrounded PWA rather than letting it retry in the
 * background.
 *
 * Reference-counted so several components can call it. The listeners are held
 * in named variables because `removeEventListener` compares by identity, and
 * passing a fresh arrow function to it removes nothing at all.
 */
export function startOutbox(): () => void {
  if (typeof window === "undefined") return () => {};

  runners += 1;

  if (!teardown) {
    const onOnline = () => void flushOutbox();
    const onVisible = () => { if (document.visibilityState === "visible") void flushOutbox(); };
    const timer = window.setInterval(() => void flushOutbox(), 30_000);

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    teardown = () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };

    void (async () => { publish({ pending: await pendingCount() }); await flushOutbox(); })();
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

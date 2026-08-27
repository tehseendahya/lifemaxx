/**
 * The outbox, minus the storage.
 *
 * Gyms have concrete walls, and the spec's governing rule is that logging must
 * survive one. Every write goes here first and the network is best-effort — so
 * this file is the part that decides what "best-effort" means, and it is kept
 * free of IndexedDB and `fetch` so it can be tested properly.
 *
 * Two rules do most of the work:
 *
 *  1. **Strictly in order, stop on the first failure.** `set_index` and the
 *     measured rest gap are both derived from the set before, so a queue that
 *     skipped past a stuck item and delivered set 4 before set 3 would produce
 *     a session that reads wrong forever. A blocked queue is recoverable; a
 *     scrambled session is not.
 *
 *  2. **Only retry what retrying can fix.** A 500 or a dead connection is worth
 *     another attempt. A 400 is not — the payload will be just as invalid in
 *     ten minutes, and under rule 1 it would wedge every set behind it for the
 *     rest of the session.
 */

export type OutboxKind = "set";

export interface OutboxItem {
  /** Also the row's client_id, so a retry after a lost response is not a duplicate. */
  id: string;
  kind: OutboxKind;
  url: string;
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
}

export interface OutboxStore {
  all(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(id: string): Promise<void>;
}

export type SendResult =
  | { status: "ok" }
  /** Worth another go: offline, a timeout, a 5xx, a rate limit. */
  | { status: "retry"; error: string }
  /** Never going to work: a 4xx that is about the payload, or a dead session. */
  | { status: "permanent"; error: string };

export type Send = (item: OutboxItem) => Promise<SendResult>;

/** Give up on an item eventually, so a poisoned entry cannot wedge a session. */
export const MAX_ATTEMPTS = 8;

/** 2s, 4s, 8s … capped. Long enough to outlast a lift, short enough to feel live. */
export const MAX_BACKOFF_MS = 60_000;

export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** Math.max(0, attempts - 1));
}

/** Classifies an HTTP status the way the retry rule needs it classified. */
export function classifyStatus(status: number): "ok" | "retry" | "permanent" {
  if (status >= 200 && status < 300) return "ok";
  // 408 and 429 are 4xx but explicitly mean "try again".
  if (status === 408 || status === 429) return "retry";
  if (status >= 400 && status < 500) return "permanent";
  return "retry";
}

export interface FlushResult {
  sent: number;
  /** Items abandoned as unsendable. Surfaced so the UI can say so out loud. */
  dropped: OutboxItem[];
  remaining: number;
  blocked: boolean;
}

/**
 * Delivers what it can, oldest first, and stops at the first item that will not
 * go through.
 */
export async function flush(
  store: OutboxStore,
  send: Send,
  now: number = Date.now(),
): Promise<FlushResult> {
  const queue = (await store.all()).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

  let sent = 0;
  const dropped: OutboxItem[] = [];

  for (const item of queue) {
    // Waiting out a backoff blocks the queue rather than skipping ahead —
    // ordering is the whole point.
    if (item.nextAttemptAt > now) {
      return { sent, dropped, remaining: queue.length - sent - dropped.length, blocked: true };
    }

    const result = await send(item);

    if (result.status === "ok") {
      await store.remove(item.id);
      sent += 1;
      continue;
    }

    if (result.status === "permanent") {
      await store.remove(item.id);
      dropped.push({ ...item, lastError: result.error });
      continue;
    }

    const attempts = item.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await store.remove(item.id);
      dropped.push({ ...item, attempts, lastError: result.error });
      continue;
    }

    await store.put({
      ...item,
      attempts,
      nextAttemptAt: now + backoffMs(attempts),
      lastError: result.error,
    });
    return { sent, dropped, remaining: queue.length - sent - dropped.length, blocked: true };
  }

  return { sent, dropped, remaining: 0, blocked: false };
}

/** An in-memory store. Used by the tests, and as the fallback where IndexedDB is unavailable. */
export function memoryStore(initial: OutboxItem[] = []): OutboxStore {
  const items = new Map(initial.map((i) => [i.id, i]));
  return {
    async all() { return [...items.values()]; },
    async put(item) { items.set(item.id, item); },
    async remove(id) { items.delete(id); },
  };
}

export function newClientId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();

  // `crypto.randomUUID` only exists in a secure context, so it is missing on
  // plain HTTP — a phone hitting a LAN IP, which is exactly how this app gets
  // tested before it has a domain. The old fallback returned
  // `19a3f2c1b40-4f2a9c1e`, which is not a UUID, and `sets.client_id` is a
  // uuid column: every queued set failed to deliver with a 500, breaking the
  // offline path in the one situation it exists for. Build a real v4 instead.
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

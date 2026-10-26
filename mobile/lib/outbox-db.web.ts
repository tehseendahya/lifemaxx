import { createKeyValueStore } from "./outbox-store";
import type { OutboxStore } from "./shared/outbox";

/**
 * The browser's outbox: one JSON array in `localStorage`. Metro resolves this
 * file instead of `outbox-db.ts` for the web bundle; why it is not expo-sqlite
 * is written on `createKeyValueStore`.
 *
 * `localStorage` can be missing or throw on access (a private window with
 * storage blocked, a sandboxed frame). That throw reaches the caller, which
 * queues in memory for the life of the tab instead.
 */
export async function openOutboxStore(): Promise<OutboxStore> {
  const storage = window.localStorage;
  // Touch it once, so a store that throws on use fails here, where the
  // caller can fall back, rather than on the first set.
  storage.getItem("lifemaxx.outbox");
  return createKeyValueStore(storage);
}

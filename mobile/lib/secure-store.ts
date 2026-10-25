import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import { createChunkedStore, type KeyValueStore } from "./chunked-store";

export type { KeyValueStore } from "./chunked-store";
export { createChunkedStore, splitByBytes, utf8Length, MAX_CHUNK_BYTES } from "./chunked-store";

/**
 * The platform binding for `./chunked-store`.
 *
 * Split in two for the same reason `src/lib/outbox/queue.ts` is split from its
 * Dexie shim: the rules worth testing are in the chunking, and a file that
 * imports `react-native` and `expo-secure-store` cannot be loaded by a node
 * test runner at all. Everything with a decision in it lives next door and is
 * tested against a fake; this file is wiring.
 */

function memoryBacked(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    async getItem(key) { return map.get(key) ?? null; },
    async setItem(key, value) { map.set(key, value); },
    async removeItem(key) { map.delete(key); },
  };
}

function webBacked(): KeyValueStore {
  return {
    async getItem(key) { return globalThis.localStorage?.getItem(key) ?? null; },
    async setItem(key, value) { globalThis.localStorage?.setItem(key, value); },
    async removeItem(key) { globalThis.localStorage?.removeItem(key); },
  };
}

function secureBacked(): KeyValueStore {
  return {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
    removeItem: (key) => SecureStore.deleteItemAsync(key),
  };
}

/**
 * `expo-secure-store` has no web implementation, and `npx expo start --web` is
 * the only visual smoke test available without a device. localStorage keeps
 * that path working; it is not secure, but nothing on the web target is and no
 * real session is expected to live there.
 *
 * The memory fallback means a keychain failure degrades to "signed out when you
 * relaunch" rather than an app that cannot start.
 */
function platformStore(): KeyValueStore {
  if (Platform.OS === "web") return webBacked();
  try {
    return secureBacked();
  } catch {
    console.warn("[store] SecureStore unavailable — persisting in memory for this launch only.");
    return memoryBacked();
  }
}

/** Raw platform storage. Small values only — use `chunkedStore` for anything that can grow. */
export const rawStore: KeyValueStore = platformStore();

/** Size-unlimited storage, for the Supabase session. */
export const chunkedStore: KeyValueStore = createChunkedStore(rawStore);

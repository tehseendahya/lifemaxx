/**
 * Key/value storage for the two things that must survive an app restart: the
 * Supabase session and the API base URL override.
 *
 * The chunking in here is not an optimisation. `expo-secure-store` warns above
 * 2048 bytes per value and can fail outright, and a Supabase session JSON
 * (access token + refresh token + user object) is comfortably past that. A
 * naive adapter therefore *appears* to work — sign-in succeeds, the screen
 * loads — and then the session is silently absent on next launch, which looks
 * like a server bug and is not one.
 */

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Keychain's documented ceiling is 2048 bytes; 1800 leaves room for the key
 * name and whatever framing the platform adds without having to know what that
 * framing is.
 */
export const MAX_CHUNK_BYTES = 1800;

/** UTF-8 byte length of one code point. Cheaper and more portable than TextEncoder, which Hermes does not reliably expose. */
function codePointBytes(cp: number): number {
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

export function utf8Length(value: string): number {
  let bytes = 0;
  for (const ch of value) bytes += codePointBytes(ch.codePointAt(0)!);
  return bytes;
}

/**
 * Splits on code-point boundaries, measuring in UTF-8 bytes.
 *
 * Both halves of that matter. The limit the platform enforces is in bytes, so
 * slicing by `.length` (UTF-16 code units) overshoots for any non-ASCII
 * content — a display name with an accent in it is enough. And iterating code
 * points rather than code units means an emoji's surrogate pair is never split
 * across two chunks, which would store two lone surrogates and reassemble into
 * mojibake after a round trip through the keychain's UTF-8 encoding.
 */
export function splitByBytes(value: string, maxBytes: number = MAX_CHUNK_BYTES): string[] {
  if (value === "") return [""];

  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const ch of value) {
    const size = codePointBytes(ch.codePointAt(0)!);
    if (currentBytes + size > maxBytes && current !== "") {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += ch;
    currentBytes += size;
  }

  chunks.push(current);
  return chunks;
}

/**
 * Wraps a store whose values are size-limited into one whose values are not.
 *
 * A value is written as `<key>.0 … <key>.n` plus `<key>.count`. The count is
 * written *last* on purpose: if the process dies halfway through a write, there
 * is no count claiming more chunks than were actually stored.
 */
export function createChunkedStore(
  inner: KeyValueStore,
  maxBytes: number = MAX_CHUNK_BYTES,
): KeyValueStore {
  const countKey = (key: string) => `${key}.count`;
  const chunkKey = (key: string, i: number) => `${key}.${i}`;

  async function clear(key: string, count: number): Promise<void> {
    await Promise.all([
      inner.removeItem(countKey(key)),
      ...Array.from({ length: count }, (_, i) => inner.removeItem(chunkKey(key, i))),
    ]);
  }

  return {
    async getItem(key) {
      const raw = await inner.getItem(countKey(key));
      if (raw === null) return null;

      const count = Number.parseInt(raw, 10);
      if (!Number.isInteger(count) || count < 1) {
        await clear(key, 0);
        return null;
      }

      const parts = await Promise.all(
        Array.from({ length: count }, (_, i) => inner.getItem(chunkKey(key, i))),
      );

      // A missing chunk means the stored value cannot be reconstructed. Return
      // null rather than a truncated session — a truncated session parses as
      // JSON about half the time and then fails authentication in a way that
      // looks like the token was rejected. Clearing it forces a clean sign-in.
      if (parts.some((p) => p === null)) {
        await clear(key, count);
        return null;
      }

      return parts.join("");
    },

    async setItem(key, value) {
      const previous = await inner.getItem(countKey(key));
      const chunks = splitByBytes(value, maxBytes);

      for (let i = 0; i < chunks.length; i += 1) {
        await inner.setItem(chunkKey(key, i), chunks[i]);
      }

      // Drop chunks left over from a longer previous value, or they linger in
      // the keychain forever.
      const before = previous === null ? 0 : Number.parseInt(previous, 10);
      if (Number.isInteger(before)) {
        for (let i = chunks.length; i < before; i += 1) {
          await inner.removeItem(chunkKey(key, i));
        }
      }

      await inner.setItem(countKey(key), String(chunks.length));
    },

    async removeItem(key) {
      const raw = await inner.getItem(countKey(key));
      const count = raw === null ? 0 : Number.parseInt(raw, 10);
      await clear(key, Number.isInteger(count) ? count : 0);
    },
  };
}

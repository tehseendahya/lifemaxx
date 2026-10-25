import { describe, it, expect } from "vitest";
import {
  createChunkedStore, splitByBytes, utf8Length, MAX_CHUNK_BYTES,
  type KeyValueStore,
} from "./chunked-store";

/**
 * The failure this guards against is specific and nasty: a session that writes
 * successfully, reads back as `null` on next launch, and looks exactly like the
 * server rejecting the token. SecureStore warns above 2048 bytes per value and
 * a Supabase session JSON is past that, so the sizes below are the ones that
 * matter — either side of the limit, and well past it.
 */

/** A store that enforces SecureStore's per-value ceiling, which the real one does loudly and then badly. */
function fakeStore(limitBytes = 2048) {
  const map = new Map<string, string>();
  const store: KeyValueStore = {
    async getItem(key) { return map.get(key) ?? null; },
    async setItem(key, value) {
      if (utf8Length(value) > limitBytes) {
        throw new Error(`value for ${key} is ${utf8Length(value)} bytes, over the ${limitBytes} limit`);
      }
      map.set(key, value);
    },
    async removeItem(key) { map.delete(key); },
  };
  return { store, map };
}

const str = (n: number, ch = "a") => ch.repeat(n);

describe("utf8Length", () => {
  it("counts bytes, not code units", () => {
    expect(utf8Length("abc")).toBe(3);
    expect(utf8Length("é")).toBe(2);
    expect(utf8Length("☃")).toBe(3);
    // One code point, two UTF-16 code units, four UTF-8 bytes.
    expect(utf8Length("🏋")).toBe(4);
  });
});

describe("splitByBytes", () => {
  it("keeps every chunk inside the byte limit", () => {
    for (const chunk of splitByBytes(str(10_000), 1800)) {
      expect(utf8Length(chunk)).toBeLessThanOrEqual(1800);
    }
  });

  it("does not split a surrogate pair across chunks", () => {
    // 4 bytes each, limit 10 → 2 per chunk with 2 bytes spare, never 2.5.
    const chunks = splitByBytes("🏋".repeat(6), 10);
    for (const chunk of chunks) {
      expect(utf8Length(chunk)).toBeLessThanOrEqual(10);
      // A split pair would leave a lone surrogate, which encodes as U+FFFD.
      expect(chunk).not.toContain("�");
      expect([...chunk].every((c) => c === "🏋")).toBe(true);
    }
    expect(chunks.join("")).toBe("🏋".repeat(6));
  });

  it("round-trips an empty string as one empty chunk", () => {
    expect(splitByBytes("")).toEqual([""]);
  });
});

describe("createChunkedStore", () => {
  const sizes = [1, 2047, 2049, 10_240];

  for (const size of sizes) {
    it(`round-trips a ${size}-byte value`, async () => {
      const { store } = fakeStore();
      const chunked = createChunkedStore(store);
      const value = str(size);

      await chunked.setItem("session", value);
      expect(await chunked.getItem("session")).toBe(value);
    });
  }

  it("round-trips a value that is entirely multi-byte", async () => {
    const { store } = fakeStore();
    const chunked = createChunkedStore(store);
    const value = "héllo☃🏋".repeat(500);

    await chunked.setItem("session", value);
    expect(await chunked.getItem("session")).toBe(value);
  });

  it("writes a 10KB value the underlying store would otherwise reject", async () => {
    const { store } = fakeStore();
    const value = str(10_240);

    // Proves the fake is actually enforcing a limit, so the test above is
    // testing the chunking rather than a store that accepts anything.
    await expect(store.setItem("raw", value)).rejects.toThrow(/over the 2048 limit/);
    await expect(createChunkedStore(store).setItem("session", value)).resolves.toBeUndefined();
  });

  it("returns null for a key that was never written", async () => {
    const { store } = fakeStore();
    expect(await createChunkedStore(store).getItem("missing")).toBeNull();
  });

  it("writes the count last, so a half-written value is not readable", async () => {
    const { store, map } = fakeStore();
    const chunked = createChunkedStore(store);
    await chunked.setItem("session", str(5000));

    expect(map.get("session.count")).toBe("3");
    // A count of 3 means chunks 0..2 exist; nothing claims a chunk that does not.
    expect(map.has("session.0")).toBe(true);
    expect(map.has("session.2")).toBe(true);
    expect(map.has("session.3")).toBe(false);
  });

  it("returns null and clears up when a chunk has gone missing", async () => {
    const { store, map } = fakeStore();
    const chunked = createChunkedStore(store);
    await chunked.setItem("session", str(5000));

    // An eviction, a partial wipe, or a half-finished write.
    map.delete("session.1");

    // Null rather than a truncated value: a truncated session JSON parses
    // often enough to then fail authentication in a way that looks like the
    // token was rejected.
    expect(await chunked.getItem("session")).toBeNull();
    expect(map.size).toBe(0);
  });

  it("removes every chunk and the count", async () => {
    const { store, map } = fakeStore();
    const chunked = createChunkedStore(store);

    await chunked.setItem("session", str(5000));
    expect(map.size).toBeGreaterThan(1);

    await chunked.removeItem("session");
    expect(map.size).toBe(0);
    expect(await chunked.getItem("session")).toBeNull();
  });

  it("drops leftover chunks when a value is replaced by a shorter one", async () => {
    const { store, map } = fakeStore();
    const chunked = createChunkedStore(store);

    await chunked.setItem("session", str(9000));
    const wide = map.size;

    await chunked.setItem("session", "small");

    expect(map.size).toBeLessThan(wide);
    expect(map.get("session.count")).toBe("1");
    expect(map.has("session.1")).toBe(false);
    expect(await chunked.getItem("session")).toBe("small");
  });

  it("recovers from a corrupt count rather than throwing", async () => {
    const { store, map } = fakeStore();
    const chunked = createChunkedStore(store);

    map.set("session.count", "not a number");
    expect(await chunked.getItem("session")).toBeNull();

    // And is usable again afterwards.
    await chunked.setItem("session", "fresh");
    expect(await chunked.getItem("session")).toBe("fresh");
  });

  it("keeps two keys independent", async () => {
    const { store } = fakeStore();
    const chunked = createChunkedStore(store);

    await chunked.setItem("a", str(5000, "x"));
    await chunked.setItem("b", str(3000, "y"));

    expect(await chunked.getItem("a")).toBe(str(5000, "x"));
    await chunked.removeItem("a");
    expect(await chunked.getItem("b")).toBe(str(3000, "y"));
  });

  it("defaults to a chunk size under SecureStore's limit", () => {
    expect(MAX_CHUNK_BYTES).toBeLessThan(2048);
  });
});

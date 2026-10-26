import { describe, it, expect } from "vitest";
import {
  createKeyValueStore, createSqliteStore, dropStaleStarts, rowToItem, CREATE_TABLE,
  MAX_SESSION_START_AGE_MS, WEB_OUTBOX_KEY,
  type BindValue, type KeyValueLike, type OutboxRow, type SqliteLike,
} from "./outbox-store";
import {
  flush, memoryStore, MAX_ATTEMPTS, backoffMs,
  type OutboxItem, type Send,
} from "./shared/outbox";

/**
 * Two things are under test here, and neither of them is SQLite.
 *
 * First, the row mapping: a payload that round-trips through JSON wrong, or a
 * `put` that inserts where it should upsert, breaks the queue in ways that only
 * show up after a failed delivery — on a phone, in a basement.
 *
 * Second, that the adapter actually satisfies the `OutboxStore` contract well
 * enough for the **real** shared `flush()` to drive it. The delivery rules
 * themselves are already tested in `src/lib/outbox/queue.test.ts`; what is new
 * here is this store behind them.
 */

/**
 * A fake that understands the three statements this adapter issues.
 *
 * It recognises them by shape rather than interpreting SQL, which means a
 * rewritten query fails loudly here instead of silently passing a test that is
 * no longer testing anything.
 */
function fakeDb() {
  const rows = new Map<string, OutboxRow>();
  const statements: string[] = [];

  const db: SqliteLike = {
    async execAsync(sql) {
      statements.push(sql);
      return undefined;
    },

    async runAsync(sql, params: BindValue[]) {
      statements.push(sql);

      if (sql.startsWith("INSERT INTO outbox")) {
        const [id, kind, url, payload, createdAt, attempts, nextAttemptAt, lastError] = params;
        const key = String(id);
        const existing = rows.get(key);

        if (existing) {
          // ON CONFLICT DO UPDATE: only these three columns move. payload and
          // created_at are deliberately left alone.
          rows.set(key, {
            ...existing,
            attempts: Number(attempts),
            next_attempt_at: Number(nextAttemptAt),
            last_error: lastError === null ? null : String(lastError),
          });
        } else {
          rows.set(key, {
            id: key,
            kind: String(kind),
            url: String(url),
            payload: String(payload),
            created_at: Number(createdAt),
            attempts: Number(attempts),
            next_attempt_at: Number(nextAttemptAt),
            last_error: lastError === null ? null : String(lastError),
          });
        }
        return { changes: 1 };
      }

      if (sql.startsWith("DELETE FROM outbox")) {
        rows.delete(String(params[0]));
        return { changes: 1 };
      }

      throw new Error(`fakeDb got a statement it does not model: ${sql}`);
    },

    async getAllAsync(sql) {
      statements.push(sql);
      if (!sql.startsWith("SELECT * FROM outbox")) {
        throw new Error(`fakeDb got a statement it does not model: ${sql}`);
      }
      return [...rows.values()].sort(
        (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
      );
    },
  };

  return { db, rows, statements };
}

function item(over: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "set",
    url: "/api/sets",
    payload: { exerciseId: "abc", reps: 6, weightLb: 45 },
    createdAt: 1_000,
    attempts: 0,
    nextAttemptAt: 0,
    ...over,
  };
}

describe("CREATE_TABLE", () => {
  it("is idempotent, because it runs on every launch", () => {
    expect(CREATE_TABLE).toContain("IF NOT EXISTS");
  });

  it("keys on id, which is also the row's client_id", () => {
    expect(CREATE_TABLE).toContain("id TEXT PRIMARY KEY");
  });
});

describe("rowToItem", () => {
  it("decodes the JSON payload", () => {
    const decoded = rowToItem({
      id: "a", kind: "set", url: "/api/sets",
      payload: '{"reps":6,"weightLb":45}',
      created_at: 7, attempts: 2, next_attempt_at: 9, last_error: "500 oops",
    });

    expect(decoded.payload).toEqual({ reps: 6, weightLb: 45 });
    expect(decoded.attempts).toBe(2);
    expect(decoded.lastError).toBe("500 oops");
  });

  it("maps a null last_error to undefined, not null", () => {
    // `OutboxItem.lastError` is optional, not nullable; `null` would not match
    // the shared type and would show up as the string "null" in a UI.
    const decoded = rowToItem({
      id: "a", kind: "set", url: "/api/sets", payload: "{}",
      created_at: 1, attempts: 0, next_attempt_at: 0, last_error: null,
    });
    expect(decoded.lastError).toBeUndefined();
    expect("lastError" in decoded).toBe(true);
  });

  it("carries the session-start kind through", () => {
    const decoded = rowToItem({
      id: "a", kind: "session-start", url: "/api/session/start", payload: "{}",
      created_at: 1, attempts: 0, next_attempt_at: 0, last_error: null,
    });
    expect(decoded.kind).toBe("session-start");
  });
});

describe("createSqliteStore", () => {
  it("round-trips an item, payload and all", async () => {
    const { db } = fakeDb();
    const store = createSqliteStore(db);
    const original = item();

    await store.put(original);
    const [read] = await store.all();

    expect(read).toEqual(original);
  });

  it("upserts rather than inserting twice", async () => {
    const { db, rows } = fakeDb();
    const store = createSqliteStore(db);

    await store.put(item());
    await store.put(item({ attempts: 1, nextAttemptAt: 5_000, lastError: "503" }));

    expect(rows.size).toBe(1);
    const [read] = await store.all();
    expect(read.attempts).toBe(1);
    expect(read.nextAttemptAt).toBe(5_000);
    expect(read.lastError).toBe("503");
  });

  it("does not let a retry rewrite the payload or the logged time", async () => {
    const { db } = fakeDb();
    const store = createSqliteStore(db);

    await store.put(item({ payload: { reps: 6 }, createdAt: 1_000 }));
    // What `flush()` writes back on a failed attempt — same id, bumped attempt.
    await store.put(item({ payload: { reps: 999 }, createdAt: 9_999, attempts: 1 }));

    const [read] = await store.all();
    expect(read.payload).toEqual({ reps: 6 });
    expect(read.createdAt).toBe(1_000);
  });

  it("returns items oldest first", async () => {
    const { db } = fakeDb();
    const store = createSqliteStore(db);

    await store.put(item({ id: "c", createdAt: 300 }));
    await store.put(item({ id: "a", createdAt: 100 }));
    await store.put(item({ id: "b", createdAt: 200 }));

    expect((await store.all()).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("removes one item without touching the others", async () => {
    const { db } = fakeDb();
    const store = createSqliteStore(db);

    await store.put(item({ id: "a", createdAt: 1 }));
    await store.put(item({ id: "b", createdAt: 2 }));
    await store.remove("a");

    expect((await store.all()).map((i) => i.id)).toEqual(["b"]);
  });

  it("is empty, not broken, on a fresh database", async () => {
    const { db } = fakeDb();
    expect(await createSqliteStore(db).all()).toEqual([]);
  });

  it("preserves a payload with nested values and nulls", async () => {
    const { db } = fakeDb();
    const store = createSqliteStore(db);
    const payload = {
      clientId: "x", reps: 6, weightLb: 45, rpe: null,
      toFailure: false, note: "felt heavy — bar \"slipped\"",
      rawText: "did 3 sets weighted pull ups 45lbs for 6 reps",
    };

    await store.put(item({ payload }));
    expect((await store.all())[0].payload).toEqual(payload);
  });
});

describe("the adapter under the real shared flush()", () => {
  it("delivers in order and empties the queue", async () => {
    const { db } = fakeDb();
    const store = createSqliteStore(db);
    const seen: string[] = [];

    await store.put(item({ id: "a", createdAt: 1 }));
    await store.put(item({ id: "b", createdAt: 2 }));
    await store.put(item({ id: "c", createdAt: 3 }));

    const send: Send = async (i) => { seen.push(i.id); return { status: "ok" }; };
    const result = await flush(store, send);

    expect(seen).toEqual(["a", "b", "c"]);
    expect(result.sent).toBe(3);
    expect(await store.all()).toEqual([]);
  });

  it("stops at the first failure and leaves the rest queued, in order", async () => {
    const { db } = fakeDb();
    const store = createSqliteStore(db);

    await store.put(item({ id: "a", createdAt: 1 }));
    await store.put(item({ id: "b", createdAt: 2 }));
    await store.put(item({ id: "c", createdAt: 3 }));

    // `set_index` and the measured rest gap are both derived from the set
    // before, so delivering c before b would produce a session that reads wrong
    // permanently.
    const send: Send = async (i) =>
      i.id === "b" ? { status: "retry", error: "offline" } : { status: "ok" };

    const result = await flush(store, send, 0);

    expect(result.sent).toBe(1);
    expect(result.blocked).toBe(true);
    expect((await store.all()).map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("persists the attempt count and backoff through the store", async () => {
    const { db } = fakeDb();
    const store = createSqliteStore(db);
    await store.put(item({ id: "a", createdAt: 1 }));

    const send: Send = async () => ({ status: "retry", error: "503" });
    await flush(store, send, 0);

    const [read] = await store.all();
    expect(read.attempts).toBe(1);
    expect(read.nextAttemptAt).toBe(backoffMs(1));
    expect(read.lastError).toBe("503");
  });

  it("drops a permanently undeliverable item instead of wedging the queue", async () => {
    const { db } = fakeDb();
    const store = createSqliteStore(db);

    await store.put(item({ id: "a", createdAt: 1 }));
    await store.put(item({ id: "b", createdAt: 2 }));

    const send: Send = async (i) =>
      i.id === "a" ? { status: "permanent", error: "400 bad reps" } : { status: "ok" };

    const result = await flush(store, send, 0);

    expect(result.dropped.map((i) => i.id)).toEqual(["a"]);
    expect(result.sent).toBe(1);
    expect(await store.all()).toEqual([]);
  });

  it("gives up after MAX_ATTEMPTS", async () => {
    const { db } = fakeDb();
    const store = createSqliteStore(db);
    await store.put(item({ id: "a", createdAt: 1, attempts: MAX_ATTEMPTS - 1 }));

    const result = await flush(store, async () => ({ status: "retry", error: "503" }), 0);

    expect(result.dropped.map((i) => i.id)).toEqual(["a"]);
    expect(await store.all()).toEqual([]);
  });

  it("delivers a queued session start before the sets behind it", async () => {
    const { db } = fakeDb();
    const store = createSqliteStore(db);
    const seen: string[] = [];

    // POST /api/sets resolves the workout server-side and the set payload
    // carries no workout id, so the start has to land first or every set after
    // it fails with "Start a session first."
    await store.put(item({ id: "start", kind: "session-start", url: "/api/session/start", createdAt: 1 }));
    await store.put(item({ id: "set-1", createdAt: 2 }));
    await store.put(item({ id: "set-2", createdAt: 3 }));

    await flush(store, async (i) => { seen.push(i.url); return { status: "ok" }; });

    expect(seen).toEqual(["/api/session/start", "/api/sets", "/api/sets"]);
  });
});

/** `localStorage`, as far as the browser store uses it. */
function fakeKv(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    kv: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, v); },
    } satisfies KeyValueLike,
  };
}

describe("createKeyValueStore (the browser's outbox)", () => {
  it("round-trips an item, payload included", async () => {
    const { kv } = fakeKv();
    const store = createKeyValueStore(kv);
    const original = item({ payload: { exerciseId: "abc", reps: 6, weightLb: 45, note: "ok" } });

    await store.put(original);

    expect(await store.all()).toEqual([original]);
  });

  it("survives a reload: a second store over the same storage sees the rows", async () => {
    const { kv } = fakeKv();
    await createKeyValueStore(kv).put(item({ id: "a" }));

    expect((await createKeyValueStore(kv).all()).map((i) => i.id)).toEqual(["a"]);
  });

  it("returns rows oldest first", async () => {
    const { kv } = fakeKv();
    const store = createKeyValueStore(kv);
    await store.put(item({ id: "late", createdAt: 3 }));
    await store.put(item({ id: "early", createdAt: 1 }));

    expect((await store.all()).map((i) => i.id)).toEqual(["early", "late"]);
  });

  it("records a retry without rewriting what was logged", async () => {
    const { kv } = fakeKv();
    const store = createKeyValueStore(kv);
    await store.put(item({ id: "a", createdAt: 1, payload: { reps: 6 } }));

    await store.put(item({
      id: "a", createdAt: 999, payload: { reps: 99 }, attempts: 2, nextAttemptAt: 50, lastError: "503",
    }));

    const [read] = await store.all();
    expect(read.payload).toEqual({ reps: 6 });
    expect(read.createdAt).toBe(1);
    expect(read.attempts).toBe(2);
    expect(read.nextAttemptAt).toBe(50);
    expect(read.lastError).toBe("503");
  });

  it("removes by id", async () => {
    const { kv } = fakeKv();
    const store = createKeyValueStore(kv);
    await store.put(item({ id: "a", createdAt: 1 }));
    await store.put(item({ id: "b", createdAt: 2 }));

    await store.remove("a");

    expect((await store.all()).map((i) => i.id)).toEqual(["b"]);
  });

  it("reads a mangled or foreign value as an empty queue instead of throwing", async () => {
    for (const junk of ["{not json", '{"a":1}', "null", "42"]) {
      const { kv } = fakeKv({ [WEB_OUTBOX_KEY]: junk });
      expect(await createKeyValueStore(kv).all()).toEqual([]);
    }
  });

  it("is driven correctly by the real shared flush(): in order, stopping at a failure", async () => {
    const { kv } = fakeKv();
    const store = createKeyValueStore(kv);
    await store.put(item({ id: "a", createdAt: 1 }));
    await store.put(item({ id: "b", createdAt: 2 }));
    await store.put(item({ id: "c", createdAt: 3 }));

    const seen: string[] = [];
    const send: Send = async (i) => {
      seen.push(i.id);
      return i.id === "b" ? { status: "retry", error: "offline" } : { status: "ok" };
    };
    const result = await flush(store, send, 0);

    expect(seen).toEqual(["a", "b"]);
    expect(result.sent).toBe(1);
    expect((await store.all()).map((i) => i.id)).toEqual(["b", "c"]);
  });
});

describe("dropStaleStarts", () => {
  const now = 10 * 60 * 60 * 1000;

  it("drops a session start older than six hours", async () => {
    const store = memoryStore([
      item({ id: "old", kind: "session-start", createdAt: now - MAX_SESSION_START_AGE_MS - 1 }),
    ]);

    const dropped = await dropStaleStarts(store, now);

    expect(dropped.map((i) => i.id)).toEqual(["old"]);
    expect(dropped[0].lastError).toMatch(/six hours/);
    expect(await store.all()).toEqual([]);
  });

  it("keeps a session start inside the window", async () => {
    const store = memoryStore([
      item({ id: "recent", kind: "session-start", createdAt: now - MAX_SESSION_START_AGE_MS + 1 }),
    ]);

    expect(await dropStaleStarts(store, now)).toEqual([]);
    expect((await store.all()).map((i) => i.id)).toEqual(["recent"]);
  });

  it("never drops a set, however old", async () => {
    // A set carries its own loggedAt and lands on the right day whenever it
    // arrives; only the *start* decides a workout's local_date, which is why
    // the age cap applies to one kind and not the other.
    const store = memoryStore([item({ id: "ancient", kind: "set", createdAt: 0 })]);

    expect(await dropStaleStarts(store, now)).toEqual([]);
    expect((await store.all()).map((i) => i.id)).toEqual(["ancient"]);
  });

  it("matches the spec's six-hour auto-abandon rule", () => {
    expect(MAX_SESSION_START_AGE_MS).toBe(6 * 60 * 60 * 1000);
  });
});

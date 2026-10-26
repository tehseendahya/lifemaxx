import type { OutboxItem, OutboxKind, OutboxStore } from "./shared/outbox";

/**
 * The SQLite half of the outbox, with no SQLite in it.
 *
 * Split from `./outbox.ts` so it can be tested: the delivery rules live in the
 * shared `queue.ts` and are already covered, but the row mapping is new code
 * and is exactly the kind of thing that silently works until a payload
 * round-trips through JSON wrong. A file importing `expo-sqlite` cannot be
 * loaded in a node test runner, so the mapping lives here behind an interface
 * and `./outbox.ts` passes it the real database.
 */

/**
 * Narrower than `unknown` on purpose: these are the only three types this
 * adapter ever binds, and widening it makes the interface incompatible with
 * expo-sqlite's `SQLiteBindParams`, which does not accept arbitrary values.
 */
export type BindValue = string | number | null;

export interface SqliteLike {
  execAsync(sql: string): Promise<unknown>;
  runAsync(sql: string, params: BindValue[]): Promise<unknown>;
  // `params` is required rather than optional: expo-sqlite's non-variadic
  // overload declares it required, and an optional one is not assignable to it.
  getAllAsync(sql: string, params: BindValue[]): Promise<unknown[]>;
}

export interface OutboxRow {
  id: string;
  kind: string;
  url: string;
  payload: string;
  created_at: number;
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
}

export const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    url TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );
`;

export function rowToItem(row: OutboxRow): OutboxItem {
  return {
    id: row.id,
    kind: row.kind as OutboxKind,
    url: row.url,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    createdAt: row.created_at,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    // The column is nullable but the field is optional, and `lastError: null`
    // would not match the shared `OutboxItem` type.
    lastError: row.last_error ?? undefined,
  };
}

/** The `OutboxStore` the shared `flush()` expects, over SQLite. */
export function createSqliteStore(db: SqliteLike): OutboxStore {
  return {
    async all() {
      // Ordered oldest-first here as well as in `flush()`. The shared queue
      // sorts what it is given, but a store returning rows in an arbitrary
      // order makes every debugging session harder than it needs to be.
      const rows = (await db.getAllAsync(
        "SELECT * FROM outbox ORDER BY created_at ASC, id ASC",
        [],
      )) as OutboxRow[];
      return rows.map(rowToItem);
    },

    async put(item) {
      // Upsert, not insert: `flush()` calls `put` again on an item already in
      // the table to record an attempt count and a backoff. The conflict clause
      // deliberately leaves `payload` and `created_at` alone — a retry must not
      // be able to rewrite what was logged or when.
      await db.runAsync(
        `INSERT INTO outbox (id, kind, url, payload, created_at, attempts, next_attempt_at, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           attempts = excluded.attempts,
           next_attempt_at = excluded.next_attempt_at,
           last_error = excluded.last_error`,
        [
          item.id,
          item.kind,
          item.url,
          JSON.stringify(item.payload),
          item.createdAt,
          item.attempts,
          item.nextAttemptAt,
          item.lastError ?? null,
        ],
      );
    },

    async remove(id) {
      await db.runAsync("DELETE FROM outbox WHERE id = ?", [id]);
    },
  };
}

// ------------------------------------------------------------ the browser's

/** The two calls the browser store needs; `window.localStorage` has both. */
export interface KeyValueLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const WEB_OUTBOX_KEY = "lifemaxx.outbox";

/**
 * The `OutboxStore` for the laptop, over `localStorage`.
 *
 * Not expo-sqlite's web build, which is the obvious choice and the wrong one
 * here. It runs wa-sqlite in a Web Worker created from
 * `new URL("./worker", window.location.href)` — a path relative to whatever
 * page is open, which `expo export` does not emit. Behind the server's
 * catch-all SPA rewrite that request comes back as `index.html`, the worker
 * never answers, and opening the database waits forever instead of throwing:
 * `getStore()` would never settle, the memory fallback would never engage, and
 * every set logged on the laptop would silently go nowhere. Its synchronous
 * calls also need `SharedArrayBuffer`, which means cross-origin isolation
 * headers (COOP/COEP) on the whole site. A laptop's
 * queue is a handful of rows that are usually delivered in the same second;
 * one JSON array in `localStorage` is durable across a reload, needs nothing
 * from the server, and cannot hang.
 *
 * Every read parses the stored array and every write rewrites it, so two tabs
 * see each other's rows on their next flush. A corrupt or foreign value reads
 * as an empty queue rather than throwing: losing a queue the browser mangled is
 * better than a save button that throws on every press.
 */
export function createKeyValueStore(kv: KeyValueLike, key = WEB_OUTBOX_KEY): OutboxStore {
  const read = (): OutboxItem[] => {
    try {
      const parsed: unknown = JSON.parse(kv.getItem(key) ?? "[]");
      return Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
    } catch {
      return [];
    }
  };
  const write = (items: OutboxItem[]) => kv.setItem(key, JSON.stringify(items));

  return {
    async all() {
      // Oldest first, for the same reason the SQLite store orders its rows.
      return read().sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    },

    async put(item) {
      const items = read();
      const at = items.findIndex((i) => i.id === item.id);
      if (at === -1) {
        items.push(item);
      } else {
        // The same upsert rule as the SQLite store: a retry records its
        // attempt and backoff, and may not rewrite what was logged or when.
        const current = items[at];
        items[at] = {
          ...current,
          attempts: item.attempts,
          nextAttemptAt: item.nextAttemptAt,
          lastError: item.lastError,
        };
      }
      write(items);
    },

    async remove(id) {
      write(read().filter((i) => i.id !== id));
    },
  };
}

// ------------------------------------------------------- stale session starts

/**
 * Matches the spec's auto-abandon rule (SPEC.md: a session left open more than
 * ~6 hours is closed as `abandoned`).
 *
 * A `session-start` delivered the next morning would create a workout against
 * the wrong `local_date`, and every set queued behind it would be filed into
 * that wrong day — which is worse than losing them, because the result looks
 * plausible. So a start this old is dropped and said out loud instead.
 */
export const MAX_SESSION_START_AGE_MS = 6 * 60 * 60 * 1000;

export async function dropStaleStarts(
  store: OutboxStore,
  now: number,
): Promise<OutboxItem[]> {
  const stale = (await store.all()).filter(
    (i) => i.kind === "session-start" && now - i.createdAt > MAX_SESSION_START_AGE_MS,
  );

  for (const item of stale) {
    await store.remove(item.id);
  }

  return stale.map((i) => ({
    ...i,
    lastError: "The session was more than six hours old and was not started.",
  }));
}

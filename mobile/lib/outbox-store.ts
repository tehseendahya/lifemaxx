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

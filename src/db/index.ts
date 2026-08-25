import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __lifemaxxSql: ReturnType<typeof postgres> | undefined;
}

function connection() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  // Reuse across hot reloads; Supabase's pooler has a modest connection cap.
  if (!globalThis.__lifemaxxSql) {
    globalThis.__lifemaxxSql = postgres(url, { prepare: false, max: 5 });
  }
  return globalThis.__lifemaxxSql;
}

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * The unscoped handle. Connects as `postgres`, which bypasses row-level
 * security, so it sees every user's rows.
 *
 * Three callers legitimately need that — migrations, the exercise-catalogue
 * seed, and the cron jobs that iterate every profile before narrowing to one
 * user. Everything else must go through `db`, which is scoped. Reach for this
 * only when crossing users is the actual intent, and make that obvious at the
 * call site.
 */
export const adminDb: Db = drizzle(connection(), { schema });

const scope = new AsyncLocalStorage<Db>();

/**
 * The handle every query helper imports.
 *
 * Inside `withUser()` it resolves to that request's transaction, which has
 * dropped to the `lifemaxx_app` role and published the user id as a GUC — so
 * the RLS policies in drizzle/0001 do the filtering in Postgres, not in the
 * `where user_id = ...` clause the route handler happened to remember to add.
 * Outside a scope it falls back to `adminDb`, which keeps server components
 * that pass an explicit userId working exactly as before.
 *
 * The binding matters: drizzle's methods read `this.session`, so handing back
 * an unbound function would run the transaction's `select` against the pool's
 * connection and quietly bypass the very thing this exists to enforce.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const active = scope.getStore() ?? adminDb;
    const value = Reflect.get(active as object, prop, active);
    return typeof value === "function" ? value.bind(active) : value;
  },
  has: (_t, prop) => prop in (scope.getStore() ?? adminDb),
});

/**
 * Runs `fn` with every `db` query scoped to one user by the database itself.
 *
 * `SET LOCAL` needs a transaction, so this opens one — which is also why the
 * callback must not contain a model call. An OpenAI round trip is seconds, and
 * Supabase's pooler runs in transaction mode: holding one open across it pins a
 * server connection for the duration. Read inside the scope, call the model
 * after it, write in a second scope.
 *
 * Nested calls reuse the outer scope rather than opening a savepoint.
 */
export async function withUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  if (scope.getStore()) return fn();

  return adminDb.transaction(async (tx) => {
    // GUC first, then drop privileges — after SET ROLE we are no longer the
    // owner, and there is no reason to find out the hard way that it matters.
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    await tx.execute(sql`set local role lifemaxx_app`);
    return scope.run(tx as unknown as Db, fn);
  });
}

/** True when the caller is already inside a scoped transaction. */
export const isScoped = (): boolean => scope.getStore() !== undefined;

export { schema };

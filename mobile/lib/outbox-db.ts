import * as SQLite from "expo-sqlite";

import { CREATE_TABLE, createSqliteStore } from "./outbox-store";
import type { OutboxStore } from "./shared/outbox";

/**
 * The phone's durable outbox: one SQLite table.
 *
 * Split out of `outbox.ts` so the browser can have a different one —
 * `outbox-db.web.ts`, which Metro picks for the web bundle by its extension.
 * The phone's bundle never sees the web file and the web bundle never imports
 * expo-sqlite. A throw here is caught by the caller, which falls back to an
 * in-memory queue.
 */
export async function openOutboxStore(): Promise<OutboxStore> {
  const db = await SQLite.openDatabaseAsync("lifemaxx.db");
  await db.execAsync(CREATE_TABLE);
  return createSqliteStore(db);
}

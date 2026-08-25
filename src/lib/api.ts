import { NextResponse } from "next/server";
import { currentUserId } from "./supabase/server";
import { withUser } from "@/db";
import { getProfile, localDate } from "./queries";

export type Handler<T> = (ctx: {
  userId: string;
  tz: string;
  today: string;
  body: T;
}) => Promise<unknown>;

export interface RouteOptions {
  /**
   * Opt out of the automatic per-request RLS transaction.
   *
   * Exactly one reason to use this: the handler calls the model. `withUser()`
   * holds a Postgres transaction, and Supabase's pooler runs in transaction
   * mode, so wrapping a multi-second OpenAI round trip would pin a server
   * connection for its duration. Handlers that opt out must call `withUser()`
   * around their own database work — read in one scope, call the model, write
   * in another.
   */
  scope?: "auto" | "manual";
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Every data route goes through here: authenticate, resolve the user's
 * timezone once, hand the handler a today-string it can trust — and run the
 * whole thing inside a transaction scoped to that user, so the row-level
 * security policies in drizzle/0001 decide what the handler can see. A missing
 * `where user_id = ...` is then a bug that returns nothing, not a leak.
 */
export function route<T = unknown>(handler: Handler<T>, options: RouteOptions = {}) {
  return async (req: Request) => {
    const userId = await currentUserId();
    if (!userId) return jsonError("Not signed in", 401);

    let body = {} as T;
    if (req.method !== "GET") {
      try {
        body = (await req.json()) as T;
      } catch {
        body = {} as T;
      }
    }

    const run = async () => {
      const profile = await getProfile(userId);
      const tz = profile?.tz ?? "America/New_York";
      return handler({ userId, tz, today: localDate(tz), body });
    };

    try {
      const result = options.scope === "manual"
        ? await run()
        : await withUser(userId, run);
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      console.error("[api]", message, err);
      return jsonError(message, 500);
    }
  };
}

import { NextResponse } from "next/server";
import { currentUserId } from "./supabase/server";
import { corsHeadersFor } from "./auth/cors";
import { withUser } from "@/db";
import { getProfile, localDate } from "./queries";

export type Handler<T> = (ctx: {
  userId: string;
  tz: string;
  today: string;
  body: T;
  /**
   * The raw request. Handlers rarely want it, but it is the only way to reach
   * a header from inside this helper.
   */
  req: Request;
  /**
   * Parsed query string. The native read API is GET-only, and a GET has no
   * body to put parameters in — without this there is no way through `route()`
   * at all, and dynamic segments are not an option because this wrapper never
   * receives Next's `params`.
   */
  searchParams: URLSearchParams;
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

export function jsonError(message: string, status = 400, headers?: Record<string, string>) {
  return NextResponse.json({ error: message }, { status, headers });
}

/**
 * A handler-thrown error that carries its own status code.
 *
 * `route()` turns a bare `throw new Error(...)` into a 500, which is right for
 * a bug and wrong for "that date isn't a date". The read endpoints need to say
 * 400 without each of them hand-rolling a response and losing the transaction
 * wrapper.
 */
export class HttpError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
    this.name = "HttpError";
  }
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
    // Attached to every response including the 401s, because a browser that
    // cannot read the error body just reports a CORS failure instead. Empty
    // unless MOBILE_CORS_ORIGINS names the caller's origin.
    const headers = corsHeadersFor(req);

    const userId = await currentUserId(req);
    if (!userId) return jsonError("Not signed in", 401, headers);

    let body = {} as T;
    if (req.method !== "GET") {
      try {
        body = (await req.json()) as T;
      } catch {
        body = {} as T;
      }
    }

    const searchParams = new URL(req.url).searchParams;

    const run = async () => {
      const profile = await getProfile(userId);
      const tz = profile?.tz ?? "America/New_York";
      return handler({ userId, tz, today: localDate(tz), body, req, searchParams });
    };

    try {
      const result = options.scope === "manual"
        ? await run()
        : await withUser(userId, run);
      return NextResponse.json(result ?? { ok: true }, { headers });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : "Unexpected error";
      // A 400 is the caller's problem and already described by its message;
      // only the unexpected ones are worth a server log.
      if (status >= 500) console.error("[api]", message, err);
      return jsonError(message, status, headers);
    }
  };
}

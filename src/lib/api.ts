import { NextResponse } from "next/server";
import { currentUserId } from "./supabase/server";
import { getProfile, localDate } from "./queries";

export type Handler<T> = (ctx: {
  userId: string;
  tz: string;
  today: string;
  body: T;
}) => Promise<unknown>;

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Every data route goes through here: authenticate, resolve the user's
 * timezone once, hand the handler a today-string it can trust.
 */
export function route<T = unknown>(handler: Handler<T>) {
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

    const profile = await getProfile(userId);
    const tz = profile?.tz ?? "America/New_York";

    try {
      const result = await handler({ userId, tz, today: localDate(tz), body });
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      console.error("[api]", message, err);
      return jsonError(message, 500);
    }
  };
}

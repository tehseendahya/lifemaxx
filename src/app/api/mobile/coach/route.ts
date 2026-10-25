import { route } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { db } from "@/db";
import { coachMessages } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { parseLimit } from "../shared";

/**
 * Coach chat history, oldest first.
 *
 * Read newest-first because that is what the index on (user_id, created_at)
 * serves, then reversed here — the alternative is an offset the client would
 * have to compute from a count it does not have.
 *
 * Sending a message is not here: that is the existing streaming
 * POST /api/coach/chat, which the native client reads with `expo/fetch`.
 */
export const GET = route(async ({ userId, searchParams }) => {
  const limit = parseLimit(searchParams.get("limit"), 30, 100);

  const rows = await db.select()
    .from(coachMessages)
    .where(eq(coachMessages.userId, userId))
    // `id` is only a tiebreaker. Two messages can share a created_at to the
    // microsecond — the seed data does — and without it the same `limit` can
    // return the pair in either order on consecutive calls, which reads as the
    // list shuffling itself.
    .orderBy(desc(coachMessages.createdAt), desc(coachMessages.id))
    .limit(limit);

  return {
    messages: rows.reverse().map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  };
});

export const OPTIONS = preflight;

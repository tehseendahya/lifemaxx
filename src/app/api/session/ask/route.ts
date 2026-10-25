import { currentUserId } from "@/lib/supabase/server";
import { corsHeadersFor, preflight } from "@/lib/auth/cors";
import { getLlm } from "@/lib/llm";
import { MODELS } from "@/lib/models";
import { sessionMessagesFor } from "@/lib/llm/context";
import { db, withUser } from "@/db";
import { sessionMessages } from "@/db/schema";
import { getActiveWorkout, getProfile, localDate } from "@/lib/queries";

/**
 * Mid-set questions. Streamed, because you're asking on ninety seconds of rest
 * and a spinner for four of them is the difference between using this and not.
 */
export async function POST(req: Request) {
  const cors = corsHeadersFor(req);

  // Cookies for the browser, a verified bearer token for the phone. The native
  // client reads this stream with `expo/fetch`, since React Native's default
  // XHR-backed fetch leaves `response.body` undefined.
  const userId = await currentUserId(req);
  if (!userId) return new Response("Not signed in", { status: 401, headers: cors });

  const { question } = (await req.json()) as { question?: string };
  if (!question?.trim()) return new Response("Ask something.", { status: 400, headers: cors });

  // Context assembly and the question's own row, in one scoped transaction.
  // The stream that follows deliberately runs outside it: holding a Postgres
  // transaction open for the length of a model response would pin a pooler
  // connection for every second the coach is talking.
  const prepared = await withUser(userId, async () => {
    const active = await getActiveWorkout(userId);
    if (!active) return null;

    const profile = await getProfile(userId);
    const today = localDate(profile?.tz ?? "America/New_York");
    const messages = await sessionMessagesFor(userId, active.id, today, question.trim());

    await db.insert(sessionMessages).values({
      workoutId: active.id, role: "user", content: question.trim(),
    });
    return { workoutId: active.id, messages };
  });

  if (!prepared) return new Response("No active session.", { status: 400, headers: cors });
  const { workoutId, messages } = prepared;

  const encoder = new TextEncoder();
  let full = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of getLlm().stream({
          model: MODELS.sessionAsk, messages, maxTokens: 400,
        })) {
          full += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        const message = "\n\n(The coach is unreachable right now — everything else still works.)";
        controller.enqueue(encoder.encode(message));
        console.error("[session/ask]", err);
      } finally {
        if (full.trim()) {
          await withUser(userId, () => db.insert(sessionMessages).values({
            workoutId, role: "assistant", content: full,
          }));
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { ...cors, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const OPTIONS = preflight;

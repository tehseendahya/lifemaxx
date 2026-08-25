import { currentUserId } from "@/lib/supabase/server";
import { getLlm } from "@/lib/llm";
import { MODELS } from "@/lib/models";
import { buildCoachContext } from "@/lib/llm/context";
import { db, withUser } from "@/db";
import { coachMessages } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getProfile, localDate } from "@/lib/queries";

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return new Response("Not signed in", { status: 401 });

  const { question } = (await req.json()) as { question?: string };
  if (!question?.trim()) return new Response("Ask something.", { status: 400 });

  // Fourteen days of context and the question's own row, in one scoped
  // transaction; the stream below runs outside it. See session/ask for why.
  const { prefix, recent } = await withUser(userId, async () => {
    const profile = await getProfile(userId);
    const today = localDate(profile?.tz ?? "America/New_York");
    const built = await buildCoachContext(userId, today);

    const rows = await db.select().from(coachMessages)
      .where(eq(coachMessages.userId, userId))
      .orderBy(desc(coachMessages.createdAt)).limit(10);

    await db.insert(coachMessages).values({ userId, role: "user", content: question.trim() });
    return { prefix: built.prefix, recent: rows };
  });

  const messages = [
    { role: "system" as const, content: prefix },
    ...recent.reverse().map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: question.trim() },
  ];

  const encoder = new TextEncoder();
  let full = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of getLlm().stream({ model: MODELS.coachChat, messages, maxTokens: 700 })) {
          full += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        controller.enqueue(encoder.encode("\n\n(The coach is unreachable right now.)"));
        console.error("[coach/chat]", err);
      } finally {
        if (full.trim()) {
          await withUser(userId, () =>
            db.insert(coachMessages).values({ userId, role: "assistant", content: full }));
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

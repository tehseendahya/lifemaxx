"use client";
import { useState } from "react";
import { Screen, Card, Label } from "@/components/ui";

/**
 * Starters, ordered so the first two need no history at all.
 *
 * "Why did I stall last week?" was in this list and is unanswerable on an empty
 * log — a chip that reliably produces a non-answer is worse than no chip. These
 * two lead because a brand-new account can get a real answer out of them from
 * the goals text alone, which is the whole point of the coach no longer
 * refusing.
 */
const SUGGESTED = [
  "Is my plan going to get me to 205 bench by December?",
  "Which of my goals am I trading against?",
  "Am I actually progressing on bench, or just adding volume?",
  "What should I eat tonight to hit protein?",
];

export function CoachClient({ loggedDays, coverageNote, history }: {
  loggedDays: number;
  /** Set when some stream is thin; see `coachCoverageNote`. */
  coverageNote: string | null;
  history: { role: string; content: string }[];
}) {
  const [messages, setMessages] = useState(history);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setStreaming("");

    let full = "";
    try {
      const res = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.body) throw new Error();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setStreaming(full);
      }
    } catch {
      full = "Couldn't reach the coach right now.";
    }
    setMessages((m) => [...m, { role: "assistant", content: full }]);
    setStreaming("");
    setBusy(false);
  }

  return (
    <Screen title="Coach" subtitle={`Reading ${loggedDays} logged day${loggedDays === 1 ? "" : "s"}`}>
      {coverageNote !== null && (
        <Card className="mb-4">
          <p className="text-sm text-muted">{coverageNote}</p>
        </Card>
      )}

      <div className="space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div
              className={`inline-block max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-accent-soft text-accent-ink"
                  : "border border-line bg-surface whitespace-pre-wrap"
              }`}
            >{m.content}</div>
          </div>
        ))}
        {streaming && (
          <div className="inline-block max-w-[85%] whitespace-pre-wrap rounded-xl border border-line bg-surface px-3 py-2 text-sm">
            {streaming}
          </div>
        )}
      </div>

      {messages.length === 0 && (
        <Card className="mt-4">
          <Label>Try asking</Label>
          <div className="space-y-1.5">
            {SUGGESTED.map((q) => (
              <button
                key={q}
                onClick={() => ask(q)}
                className="block w-full rounded-lg border border-line px-3 py-2 text-left text-sm text-muted"
              >{q}</button>
            ))}
          </div>
        </Card>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
        className="sticky bottom-20 mt-4 flex gap-2 bg-ground py-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your data…"
          className="flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm outline-none placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-lg bg-accent px-4 text-sm font-semibold text-ground disabled:opacity-40"
        >{busy ? "…" : "Ask"}</button>
      </form>
    </Screen>
  );
}

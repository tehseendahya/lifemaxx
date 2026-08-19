"use client";
import { useState } from "react";
import { Screen, Card, Label } from "@/components/ui";

const SUGGESTED = [
  "Am I actually progressing on bench, or just adding volume?",
  "What should I eat tonight to hit protein?",
  "Which of my goals am I trading against right now?",
  "Why did I stall last week?",
];

export function CoachClient({ loggedDays, history }: {
  loggedDays: number;
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
      {loggedDays < 5 && (
        <Card className="mb-4">
          <p className="text-sm text-muted">
            Only {loggedDays} day{loggedDays === 1 ? "" : "s"} logged so far. The coach will say
            when the data is too thin to call rather than guessing — log a few more days
            and the answers get sharper.
          </p>
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

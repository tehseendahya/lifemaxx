"use client";
import { useState } from "react";
import { Card, Label } from "./ui";

const QUICK = ["Should I do another set?", "Go up in weight next time?", "How's my volume this week?"];

/**
 * Mid-set questions, streamed.
 *
 * Streaming matters here more than anywhere else in the app: you're asking on
 * ninety seconds of rest, and watching a spinner for four of them is the
 * difference between using this and forgetting it exists.
 */
export function AskCoach() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(q: string) {
    if (!q.trim()) return;
    setBusy(true);
    setAnswer("");
    setQuestion("");
    try {
      const res = await fetch("/api/session/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.body) throw new Error("No response");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        setAnswer((a) => a + decoder.decode(value, { stream: true }));
      }
    } catch {
      setAnswer("Couldn't reach the coach. Everything else still works.");
    }
    setBusy(false);
  }

  return (
    <Card className="mt-4">
      <Label>Ask</Label>
      {answer && <p className="mb-3 whitespace-pre-wrap text-sm">{answer}</p>}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {QUICK.map((q) => (
          <button
            key={q}
            onClick={() => ask(q)}
            disabled={busy}
            className="rounded-full border border-line px-3 py-1 text-xs text-muted disabled:opacity-40"
          >{q}</button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(question); }} className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Shoulder's pinching — swap to something?"
          className="flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="rounded-lg bg-accent px-4 text-sm font-semibold text-ground disabled:opacity-40"
        >{busy ? "…" : "Ask"}</button>
      </form>
    </Card>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";

import { apiStream } from "@/lib/api";

import { appendChunk, emptyStream, finishStream } from "./stream";
import type { ChatMessage, StreamState } from "./stream";

/**
 * One streaming client for both question routes.
 *
 * `/api/coach/chat` and `/api/session/ask` are deliberately different
 * endpoints — the second carries live session context and a cached prompt
 * prefix — but they stream identically, so the Lift screen's ASK control
 * imports this rather than growing a second copy of the reader loop. Pass the
 * path; everything else is the same.
 *
 * It holds only the exchanges made since it mounted. Server-side history is a
 * separate concern (`GET /api/mobile/coach`, read with react-query by the Coach
 * screen) because `/api/session/ask` has no history endpoint at all, and
 * folding one into this hook would make it useless to the caller that needs it
 * most.
 */

/**
 * Chunks are coalesced into one render per 50ms rather than one per chunk.
 *
 * A 700-token answer arrives as several hundred chunks, each in its own
 * microtask, so a setState per chunk is several hundred renders of a growing
 * text node — while the transcript is also being scrolled to the bottom on
 * every content-size change. 50ms is ~20 updates a second, which is still
 * plainly incremental to a reader and is the difference between smooth text and
 * a stuttering scroll. The final flush is unconditional, so the last few
 * characters never depend on a timer firing.
 */
const FLUSH_MS = 50;

export interface StreamingAsk {
  /** The live transcript: user questions and assistant answers, in order. */
  messages: ChatMessage[];
  send: (question: string) => void;
  streaming: boolean;
  /**
   * Set only when the request failed before any text arrived — a 400 from
   * `/api/session/ask` with no active session, a dead network, an expired
   * token. A stream that dies partway leaves `error` null and marks the
   * partial message `failed` instead, because the text already on screen is
   * worth more than an error that replaces it.
   */
  error: string | null;
  reset: () => void;
}

let seq = 0;
/**
 * Local-only ids. Deliberately not `newClientId()` from the shared outbox:
 * these never reach the server (both routes persist their own rows and mint
 * their own ids), and borrowing the outbox's uuid minting would imply they do.
 */
const nextId = (): string => `local-${++seq}`;

export function useStreamingAsk(path: string): StreamingAsk {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Guards every setState after an await: the coach modal is dismissable mid-answer. */
  const alive = useRef(true);
  /** Belt and braces against a double-tap on SEND racing the `streaming` state. */
  const inFlight = useRef(false);

  const buffer = useRef<StreamState>(emptyStream);
  const target = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      alive.current = false;
      clearTimer();
    },
    [clearTimer],
  );

  const flush = useCallback(() => {
    timer.current = null;
    const id = target.current;
    if (id === null || !alive.current) return;

    const text = buffer.current.text;
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: text } : m)));
  }, []);

  const schedule = useCallback(() => {
    if (timer.current !== null) return;
    timer.current = setTimeout(flush, FLUSH_MS);
  }, [flush]);

  const send = useCallback(
    (question: string) => {
      const text = question.trim();
      if (text === "" || inFlight.current) return;
      inFlight.current = true;

      const assistantId = nextId();
      target.current = assistantId;
      buffer.current = emptyStream;

      setError(null);
      setStreaming(true);
      // The question and an empty answer go up together, so the transcript
      // shows what was asked the instant it is asked. There is no spinner in
      // this flow: the cursor block on the empty answer is the spinner.
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", content: text },
        { id: assistantId, role: "assistant", content: "", streaming: true },
      ]);

      void (async () => {
        let failure: string | null = null;

        try {
          await apiStream(path, { question: text }, (chunk) => {
            buffer.current = appendChunk(buffer.current, chunk);
            schedule();
          });
        } catch (err) {
          failure = err instanceof Error ? err.message : "The coach is unreachable.";
        }

        buffer.current = finishStream(buffer.current);
        const finalText = buffer.current.text;
        const arrived = finalText !== "";

        inFlight.current = false;
        if (!alive.current) return;

        // Cancel the pending coalesced flush: the write below is the final one
        // and a timer firing after it would rewrite the message with the same
        // text and clear the flags set here.
        clearTimer();
        target.current = null;

        setMessages((prev) =>
          prev.flatMap((m) => {
            if (m.id !== assistantId) return [m];
            // Nothing arrived at all, so there is no partial answer worth
            // keeping — drop the empty bubble and let the error line carry it.
            // A blank message that stays in the transcript forever is worse
            // than no message.
            if (!arrived) return [];
            return [{ ...m, content: finalText, streaming: false, failed: failure !== null }];
          }),
        );

        setStreaming(false);
        if (!arrived) setError(failure ?? "The coach returned nothing. Ask again.");
      })();
    },
    [path, schedule, clearTimer],
  );

  const reset = useCallback(() => {
    clearTimer();
    target.current = null;
    buffer.current = emptyStream;
    inFlight.current = false;
    setMessages([]);
    setStreaming(false);
    setError(null);
  }, [clearTimer]);

  return { messages, send, streaming, error, reset };
}

/*
 * Imports are relative rather than `@/lib/...` for the same reason the Today
 * and Runs models are: `mobile/vitest.config.ts` runs in a plain node
 * environment with no path alias configured. A module that needs build
 * configuration before it can be tested does not get tested, and this is the
 * one piece of the coach that is worth testing.
 */
import type { CoachMessage } from "../../lib/types";

/**
 * Accumulating a streamed answer, and turning server history into transcript
 * rows. Pure — nothing here imports `react-native`, which is what keeps it
 * runnable under the node vitest config.
 */

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** True while this assistant row is still being streamed into. Drives the cursor block. */
  streaming?: boolean;
  /** The stream died partway. The partial content is kept and a muted line is drawn under it. */
  failed?: boolean;
}

// --------------------------------------------------------------- accumulator

export interface StreamState {
  /** Text that is safe to render right now. */
  text: string;
  /**
   * A trailing lone high surrogate, held back until its pair arrives.
   *
   * `apiStream` decodes with `TextDecoder({ stream: true })`, which already
   * joins a UTF-8 sequence split across two network reads — so in the normal
   * path this is always "". It is here for the two paths that bypass that
   * decoder: `apiStream`'s own `res.text()` fallback (used when a proxy buffers
   * the body and `response.body` is undefined), and any future transport that
   * decodes per chunk. Those can hand us a JS string ending in half a surrogate
   * pair, and rendering that paints a replacement character into the transcript
   * which then never goes away, because the next chunk's low surrogate is
   * equally orphaned. Holding one code unit back costs nothing and makes the
   * accumulator correct regardless of who is feeding it.
   */
  pending: string;
}

export const emptyStream: StreamState = { text: "", pending: "" };

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;

/** Folds one chunk in, holding back a dangling high surrogate. */
export function appendChunk(state: StreamState, chunk: string): StreamState {
  const combined = state.pending + chunk;
  if (combined === "") return state;

  const last = combined.charCodeAt(combined.length - 1);
  if (isHighSurrogate(last)) {
    return { text: state.text + combined.slice(0, -1), pending: combined.slice(-1) };
  }

  return { text: state.text + combined, pending: "" };
}

/**
 * Called when the stream ends.
 *
 * A held-back surrogate at this point is never going to get its pair, so it is
 * emitted rather than silently dropped: a lone replacement character in the
 * last position of an answer is odd, and a truncated last word is worse.
 */
export function finishStream(state: StreamState): StreamState {
  if (state.pending === "") return state;
  return { text: state.text + state.pending, pending: "" };
}

// ------------------------------------------------------------------- history

/**
 * `GET /api/mobile/coach` → transcript rows, oldest first.
 *
 * `role` is typed `string` on the wire because it is a database column, and a
 * row whose role is neither of the two the transcript can draw is dropped
 * rather than rendered as a mystery bubble. `coach_messages` only ever holds
 * `user` and `assistant` today, so this is a guard against a future column
 * value, not a known case.
 */
export function fromHistory(messages: CoachMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    out.push({ id: m.id, role: m.role, content: m.content });
  }
  return out;
}

/**
 * Whether the composer may send.
 *
 * Blank-only input is rejected here rather than by the route: `/api/coach/chat`
 * answers an empty question with a 400 whose body is "Ask something.", and
 * surfacing that as a red line under the field for something the user can see
 * is empty reads as a bug.
 */
export function canSend(draft: string, streaming: boolean): boolean {
  return draft.trim() !== "" && !streaming;
}

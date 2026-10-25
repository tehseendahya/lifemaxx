import { describe, expect, it } from "vitest";

import { appendChunk, canSend, emptyStream, finishStream, fromHistory } from "./stream";
import type { CoachMessage } from "../../lib/types";

/** Folds a whole stream in, the way the hook does, and returns the final text. */
function consume(chunks: string[]): string {
  let state = emptyStream;
  for (const chunk of chunks) state = appendChunk(state, chunk);
  return finishStream(state).text;
}

describe("appendChunk", () => {
  it("accumulates plain chunks in order", () => {
    expect(consume(["Bench ", "e1RM is ", "up 5.7%."])).toBe("Bench e1RM is up 5.7%.");
  });

  it("is a no-op for an empty chunk", () => {
    const state = appendChunk(emptyStream, "x");
    expect(appendChunk(state, "")).toBe(state);
  });

  it("renders text as it arrives rather than only at the end", () => {
    // The whole point of the feature: after two of three chunks, two thirds of
    // the answer must already be renderable.
    let state = appendChunk(emptyStream, "Keep the ");
    expect(state.text).toBe("Keep the ");
    state = appendChunk(state, "increment at 5lb");
    expect(state.text).toBe("Keep the increment at 5lb");
  });

  it("holds back a chunk that ends mid-character and joins it to the next", () => {
    // U+1F4AA is a surrogate pair; a per-chunk decoder can split it.
    const flex = "\u{1F4AA}";
    const high = flex.charCodeAt(0);
    const low = flex.charCodeAt(1);

    let state = appendChunk(emptyStream, `nice ${String.fromCharCode(high)}`);
    // The half character must not reach the screen.
    expect(state.text).toBe("nice ");
    expect(state.pending).toBe(String.fromCharCode(high));

    state = appendChunk(state, `${String.fromCharCode(low)} work`);
    expect(state.text).toBe(`nice ${flex} work`);
    expect(state.pending).toBe("");
  });

  it("joins a character split across three chunks", () => {
    const flex = "\u{1F4AA}";
    expect(consume(["a", flex[0], flex[1], "b"])).toBe(`a${flex}b`);
  });

  it("does not hold back a low surrogate, which is only ever a continuation", () => {
    const flex = "\u{1F4AA}";
    const state = appendChunk(appendChunk(emptyStream, flex[0]), flex[1]);
    expect(state.pending).toBe("");
    expect(state.text).toBe(flex);
  });

  it("leaves multi-byte characters that arrive whole alone", () => {
    expect(consume(["café ", "— ", "185×5"])).toBe("café — 185×5");
  });
});

describe("finishStream", () => {
  it("emits a surrogate whose pair never arrived rather than dropping it", () => {
    // Truncating the last word would be the worse failure: the user cannot tell
    // a dropped character from a coach that stopped mid-sentence.
    const state = appendChunk(emptyStream, "done \ud83d");
    expect(state.text).toBe("done ");
    expect(finishStream(state).text).toBe("done \ud83d");
  });

  it("returns the same object when there is nothing held back", () => {
    const state = appendChunk(emptyStream, "all done");
    expect(finishStream(state)).toBe(state);
  });
});

describe("fromHistory", () => {
  const row = (over: Partial<CoachMessage>): CoachMessage => ({
    id: "1", role: "user", content: "hi", createdAt: "2026-10-23T20:00:00.000Z", ...over,
  });

  it("keeps order and maps both roles", () => {
    const out = fromHistory([
      row({ id: "a", role: "user", content: "how is bench going?" }),
      row({ id: "b", role: "assistant", content: "Up 5.7% in three weeks." }),
    ]);
    expect(out).toEqual([
      { id: "a", role: "user", content: "how is bench going?" },
      { id: "b", role: "assistant", content: "Up 5.7% in three weeks." },
    ]);
  });

  it("drops a role the transcript cannot draw", () => {
    const out = fromHistory([row({ id: "a" }), row({ id: "b", role: "system" })]);
    expect(out.map((m) => m.id)).toEqual(["a"]);
  });

  it("handles an empty transcript", () => {
    expect(fromHistory([])).toEqual([]);
  });
});

describe("canSend", () => {
  it("refuses blank and whitespace-only drafts", () => {
    expect(canSend("", false)).toBe(false);
    expect(canSend("   \n ", false)).toBe(false);
  });

  it("refuses while a previous answer is still streaming", () => {
    expect(canSend("another question", true)).toBe(false);
  });

  it("allows a real question", () => {
    expect(canSend("should I add a set?", false)).toBe(true);
  });
});

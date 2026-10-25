import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import type { ResolvedExercise } from "@/lib/exercises";
import type { Transcriber } from "@/lib/llm/transcribe";

/**
 * `POST /api/voice/transcribe` — the rejections, and the one happy path that
 * needs no network.
 *
 * The transcriber is injected through the `setTranscriber` seam, the database
 * is stubbed because there is none here, and `LLM_PROVIDER=fixtures` keeps the
 * sets parse offline. What that leaves genuinely under test is this route's own
 * job: deciding what to refuse, with which status, before anything is spent on
 * it — and that the body it returns is the transcript plus the exact
 * `/api/sets/parse` shape the confirmation sheet is built against.
 *
 * `MODELS` is mocked so `transcribe` can be flipped between cases. The real
 * module reads it from the environment once at import, which is correct for a
 * server and useless for a test that needs both states.
 */

const models = { transcribe: "test-transcribe-model" as string | null, setsParse: "test-sets" };

vi.mock("@/lib/models", () => ({ MODELS: models }));

let currentUser: string | null = "user-1";

vi.mock("@/lib/supabase/server", () => ({
  currentUserId: async () => currentUser,
}));

vi.mock("@/db", () => ({
  withUser: <T>(_userId: string, fn: () => Promise<T>): Promise<T> => fn(),
}));

vi.mock("@/lib/queries", () => ({
  getProfile: async () => ({ tz: "America/New_York" }),
  localDate: () => "2026-10-25",
}));

vi.mock("@/lib/exercises", () => ({ resolveExercise: vi.fn() }));

process.env.LLM_PROVIDER = "fixtures";

const { POST } = await import("./route");
const { setTranscriber } = await import("@/lib/llm/transcribe");
const { resolveExercise } = await import("@/lib/exercises");

const BENCH: ResolvedExercise = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Barbell Bench Press",
  slug: "barbell-bench-press",
  incrementKg: 2.5,
  equipment: "barbell",
  confidence: "exact",
};

/** Stands in for the real one, and records what the route handed it. */
function stubTranscriber(transcript: string): Transcriber & { seen: { hint?: string }[] } {
  const seen: { hint?: string }[] = [];
  return {
    // Not "fixtures": `isTranscriptionConfigured()` short-circuits for the
    // fixtures transcriber, and these cases are about the real one's
    // configuration.
    name: "openai",
    seen,
    async transcribe({ hint }) {
      seen.push({ hint });
      return transcript;
    },
  };
}

function audioFile(bytes: number, type = "audio/m4a"): File {
  return new File([new Uint8Array(bytes)], "set.m4a", { type });
}

function upload(parts: { audio?: File; hint?: string } = {}): Request {
  const form = new FormData();
  if (parts.audio) form.append("audio", parts.audio);
  if (parts.hint !== undefined) form.append("hint", parts.hint);
  return new Request("http://localhost/api/voice/transcribe", { method: "POST", body: form });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  currentUser = "user-1";
  models.transcribe = "test-transcribe-model";
  setTranscriber(stubTranscriber("bench 5x5 185"));
  vi.mocked(resolveExercise).mockReset();
  vi.mocked(resolveExercise).mockResolvedValue(BENCH);
});

afterAll(() => setTranscriber(null));

describe("rejections", () => {
  it("401s when nobody is signed in, before reading any configuration", async () => {
    currentUser = null;
    const res = await POST(upload({ audio: audioFile(5_000) }));
    expect(res.status).toBe(401);
  });

  it("503s with no transcription model configured", async () => {
    models.transcribe = null;
    const res = await POST(upload({ audio: audioFile(5_000) }));

    expect(res.status).toBe(503);
    expect(await body(res)).toEqual({ error: "Transcription is not configured." });
  });

  it("400s with no audio part at all", async () => {
    const res = await POST(upload());
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: "An audio file is required." });
  });

  it("400s on a recording too short to contain a word", async () => {
    const res = await POST(upload({ audio: audioFile(400) }));
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: "Nothing recorded." });
  });

  it("413s on a recording far past the fifteen-second design maximum", async () => {
    const res = await POST(upload({ audio: audioFile(2_000_001) }));
    expect(res.status).toBe(413);
  });

  it("415s on a part that is not audio", async () => {
    const res = await POST(upload({ audio: audioFile(5_000, "image/jpeg") }));
    expect(res.status).toBe(415);
    expect(String((await body(res)).error)).toContain("image/jpeg");
  });

  it("415s when the body is not multipart at all", async () => {
    const res = await POST(new Request("http://localhost/api/voice/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: "nope" }),
    }));

    expect(res.status).toBe(415);
  });

  it("400s when the transcriber heard nothing", async () => {
    setTranscriber(stubTranscriber("   "));
    const res = await POST(upload({ audio: audioFile(5_000) }));
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: "Couldn’t make out any words." });
  });

  it("never reaches the transcriber for a request it is going to refuse", async () => {
    const stub = stubTranscriber("bench 5x5 185");
    setTranscriber(stub);

    await POST(upload({ audio: audioFile(400) }));
    await POST(upload({ audio: audioFile(5_000, "video/mp4") }));

    expect(stub.seen).toHaveLength(0);
  });
});

describe("the happy path", () => {
  it("returns the transcript plus the exact /api/sets/parse body", async () => {
    const res = await POST(upload({ audio: audioFile(45_000) }));
    expect(res.status).toBe(200);

    const data = await body(res);
    expect(data.transcript).toBe("bench 5x5 185");
    // `usedModel` false: the shorthand parser handled it, so the only model
    // call in the whole request was the transcription.
    expect(data.usedModel).toBe(false);
    expect(data.unresolved).toEqual([]);

    const entries = data.entries as { query: string; exercise: ResolvedExercise; sets: unknown[] }[];
    expect(entries).toHaveLength(1);
    expect(entries[0].query).toBe("bench");
    expect(entries[0].exercise.id).toBe(BENCH.id);
    expect(entries[0].sets).toHaveLength(5);
    expect(entries[0].sets[0]).toEqual({
      reps: 5, weight_lb: 185, rpe: null, to_failure: false, is_warmup: false,
    });
  });

  it("passes the exercise-name hint to the transcriber as a decoding prompt", async () => {
    const stub = stubTranscriber("bench 5x5 185");
    setTranscriber(stub);

    await POST(upload({ audio: audioFile(45_000), hint: "  Barbell Bench Press  " }));

    expect(stub.seen).toEqual([{ hint: "Barbell Bench Press" }]);
  });

  it("sends no hint when none was given, rather than an empty prompt", async () => {
    const stub = stubTranscriber("bench 5x5 185");
    setTranscriber(stub);

    await POST(upload({ audio: audioFile(45_000), hint: "   " }));

    expect(stub.seen).toEqual([{ hint: undefined }]);
  });

  it("truncates an over-long hint rather than refusing the upload", async () => {
    const stub = stubTranscriber("bench 5x5 185");
    setTranscriber(stub);

    await POST(upload({ audio: audioFile(45_000), hint: "x".repeat(200) }));

    expect(stub.seen[0].hint).toHaveLength(80);
  });

  it("reports an unresolved exercise rather than guessing, and still 200s", async () => {
    vi.mocked(resolveExercise).mockResolvedValue(null);
    setTranscriber(stubTranscriber("zercher thrusters 95x8"));

    const res = await POST(upload({ audio: audioFile(45_000) }));
    expect(res.status).toBe(200);

    const data = await body(res);
    expect(data.unresolved).toEqual(["zercher thrusters"]);
    // The sets survive. The phone blocks its confirm button until the user
    // picks an exercise; dropping them here would lose work silently.
    const entries = data.entries as { sets: unknown[] }[];
    expect(entries[0].sets).toHaveLength(1);
  });

  it("writes no set — this route only reads", async () => {
    const res = await POST(upload({ audio: audioFile(45_000) }));
    const data = await body(res);
    // The response carries no set id and no workout id, because nothing was
    // inserted. The outbox posts the confirmed rows to /api/sets.
    expect(Object.keys(data).sort()).toEqual(["entries", "transcript", "unresolved", "usedModel"]);
  });
});

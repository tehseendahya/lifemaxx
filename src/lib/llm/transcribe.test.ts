import { describe, it, expect, afterEach, vi } from "vitest";
import { parseShorthand } from "./shorthand";

/**
 * Provider selection and the fixture transcript.
 *
 * Nothing here talks to an audio endpoint — the real transcriber's request is
 * one SDK call and there is no local stand-in for `/audio/transcriptions` the
 * way there is for `/chat/completions`. What is worth testing is the wiring
 * around it: which implementation gets chosen, whether the route can tell an
 * unconfigured deployment from a working one, and that the offline fixture is
 * a transcript the rest of the pipeline can actually use.
 *
 * Modules are re-imported per case because both `getTranscriber()` and
 * `MODELS` read the environment at module scope, which is right for a server
 * and has to be worked around here.
 */

const ENV_KEYS = ["OPENAI_API_KEY", "LLM_PROVIDER", "OPENAI_TRANSCRIBE_MODEL"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.resetModules();
});

async function load(env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const key of ENV_KEYS) {
    if (key in env && env[key] === undefined) delete process.env[key];
    else if (key in env) process.env[key] = env[key] as string;
  }
  vi.resetModules();
  return import("./transcribe");
}

describe("provider selection", () => {
  it("uses fixtures when LLM_PROVIDER says so, even with a key present", async () => {
    const { getTranscriber } = await load({
      LLM_PROVIDER: "fixtures",
      OPENAI_API_KEY: "sk-test",
    });
    expect(getTranscriber().name).toBe("fixtures");
  });

  it("degrades to fixtures with no key rather than throwing", async () => {
    // Same choice `getLlm()` makes: a missing key should mean "the coach is
    // offline", not a 500 from a route that had nothing to do with the key.
    const { getTranscriber } = await load({
      LLM_PROVIDER: undefined,
      OPENAI_API_KEY: undefined,
    });
    expect(getTranscriber().name).toBe("fixtures");
  });

  it("uses the real provider when a key is set and fixtures are not forced", async () => {
    const { getTranscriber } = await load({
      LLM_PROVIDER: undefined,
      OPENAI_API_KEY: "sk-test",
    });
    expect(getTranscriber().name).toBe("openai");
  });

  it("caches the choice, so one request is not two clients", async () => {
    const { getTranscriber } = await load({ LLM_PROVIDER: "fixtures" });
    expect(getTranscriber()).toBe(getTranscriber());
  });

  it("lets a test inject one, and lets it be taken back out", async () => {
    const { getTranscriber, setTranscriber } = await load({ LLM_PROVIDER: "fixtures" });
    const stub = { name: "stub", transcribe: async () => "bench 185x5" };

    setTranscriber(stub);
    expect(getTranscriber()).toBe(stub);

    setTranscriber(null);
    expect(getTranscriber().name).toBe("fixtures");
  });
});

describe("isTranscriptionConfigured", () => {
  it("is true offline, so LLM_PROVIDER=fixtures demonstrates the whole flow", async () => {
    const { isTranscriptionConfigured } = await load({
      LLM_PROVIDER: "fixtures",
      OPENAI_TRANSCRIBE_MODEL: undefined,
    });
    expect(isTranscriptionConfigured()).toBe(true);
  });

  it("is false with a real key but no model id — the 503 case", async () => {
    const { isTranscriptionConfigured } = await load({
      LLM_PROVIDER: undefined,
      OPENAI_API_KEY: "sk-test",
      OPENAI_TRANSCRIBE_MODEL: undefined,
    });
    expect(isTranscriptionConfigured()).toBe(false);
  });

  it("is true once OPENAI_TRANSCRIBE_MODEL is set", async () => {
    const { isTranscriptionConfigured } = await load({
      LLM_PROVIDER: undefined,
      OPENAI_API_KEY: "sk-test",
      OPENAI_TRANSCRIBE_MODEL: "some-audio-model",
    });
    expect(isTranscriptionConfigured()).toBe(true);
  });
});

describe("MODELS.transcribe", () => {
  it("has no default, because an invented audio model id is a 400 in production", async () => {
    delete process.env.OPENAI_TRANSCRIBE_MODEL;
    vi.resetModules();
    const { MODELS } = await import("@/lib/models");
    expect(MODELS.transcribe).toBeNull();
  });

  it("comes from OPENAI_TRANSCRIBE_MODEL", async () => {
    process.env.OPENAI_TRANSCRIBE_MODEL = "some-audio-model";
    vi.resetModules();
    const { MODELS } = await import("@/lib/models");
    expect(MODELS.transcribe).toBe("some-audio-model");
  });
});

describe("the fixture transcript", () => {
  it("is shorthand the deterministic parser handles, not prose", async () => {
    const { FIXTURE_TRANSCRIPT, getTranscriber } = await load({ LLM_PROVIDER: "fixtures" });

    const transcript = await getTranscriber().transcribe({
      file: new File([new Uint8Array(2_000)], "set.m4a", { type: "audio/m4a" }),
    });
    expect(transcript).toBe(FIXTURE_TRANSCRIPT);

    // This is the load-bearing part. `FixtureProvider.structured` implements
    // `parsed_sets` by running `parseShorthand` over its input, so a prose
    // fixture would come back with zero entries and the offline demo would look
    // like a broken parser rather than a working flow.
    const entries = parseShorthand(transcript);
    expect(entries).toHaveLength(1);
    expect(entries[0].sets).toHaveLength(5);
    expect(entries[0].sets[0]).toMatchObject({ reps: 5, weight_lb: 185 });
  });
});

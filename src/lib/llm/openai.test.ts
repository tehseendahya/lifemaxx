import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MockOpenAI } from "./__testing__/mock-openai";
import { OpenAiProvider } from "./openai";
import { LlmError } from "./provider";
import {
  JSON_SCHEMAS, mealAnalysisSchema, parsedSetsSchema, suggestionSchema, exerciseMatchSchema,
} from "./schemas";
import { mealMessages, MEAL_IMAGE_DETAIL, SETS_SYSTEM, SUGGEST_SYSTEM, COACH_VOICE, stableJson } from "./prompts";
import { MODELS } from "@/lib/models";

/**
 * Contract tests for the OpenAI layer.
 *
 * api.openai.com is blocked by this environment's egress policy, so these run
 * against a local stand-in that enforces the documented request contract —
 * the strict structured-outputs schema subset, the vision content-part shape,
 * the token parameter names — and can return the response shapes that are easy
 * to forget: a refusal, and a completion truncated by the token cap.
 *
 * What this proves: every request the app builds is one the API accepts, and
 * every response it can receive is one the app survives.
 * What it cannot prove: that the model ids in lib/models.ts exist, or that the
 * answers are any good. Both need a live key.
 */

const mock = new MockOpenAI();
let llm: OpenAiProvider;

const JPEG_DATA_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==";

beforeAll(async () => {
  const baseURL = await mock.start();
  llm = new OpenAiProvider("test-key", { baseURL, maxRetries: 0, timeoutMs: 5_000 });
});

afterAll(() => mock.stop());
beforeEach(() => { mock.requests.length = 0; });

const MEAL_REPLY = JSON.stringify({
  items: [{ name: "Chicken thigh", qty: 6, unit: "oz", kcal: 340, protein_g: 38, carbs_g: 0, fat_g: 20 }],
  confidence: 0.7,
  note: "Assumed pan-cooked with about a tablespoon of oil.",
});

describe("structured-output schemas are valid under strict mode", () => {
  const cases = [
    ["meal_analysis", JSON_SCHEMAS.meal_analysis, mealAnalysisSchema, MEAL_REPLY],
    ["parsed_sets", JSON_SCHEMAS.parsed_sets, parsedSetsSchema, JSON.stringify({
      entries: [{ exercise_query: "bench", sets: [{ reps: 5, weight_lb: 185, rpe: 8, to_failure: false, is_warmup: false }] }],
    })],
    ["suggestion", JSON_SCHEMAS.suggestion, suggestionSchema, JSON.stringify({
      weight_lb: 190, sets: 3, reps: 5, reason: "Every set last session was RPE 7 and none went to failure.",
    })],
    ["exercise_match", JSON_SCHEMAS.exercise_match, exerciseMatchSchema, JSON.stringify({
      matched_slug: "barbell-bench-press", is_new: false, canonical_name: "Barbell Bench Press",
      equipment: "barbell", muscles: [{ muscle: "chest", contribution: 1 }],
    })],
  ] as const;

  for (const [name, jsonSchema, validator, reply] of cases) {
    it(`${name} round-trips`, async () => {
      mock.next = { kind: "json", content: reply };
      const result = await llm.structured({
        model: "test-model",
        messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }],
        schemaName: name,
        jsonSchema,
        validator: validator as never,
        maxTokens: 500,
      });
      expect(result).toEqual(JSON.parse(reply));

      const sent = mock.last();
      expect(sent.response_format?.json_schema?.strict).toBe(true);
      expect(sent.response_format?.json_schema?.name).toBe(name);
      // The deprecated spelling is rejected outright by the reasoning models.
      expect(sent.max_tokens).toBeUndefined();
      expect(sent.max_completion_tokens).toBe(500);
    });
  }
});

describe("meal analysis, the vision route", () => {
  it("sends the photo as a data URI on the user message", async () => {
    mock.next = { kind: "json", content: MEAL_REPLY };
    await llm.structured({
      model: MODELS.mealAnalyze,
      messages: mealMessages("Half marathon in the fall.", JPEG_DATA_URL, "chicken thigh, not breast"),
      schemaName: "meal_analysis",
      jsonSchema: JSON_SCHEMAS.meal_analysis,
      validator: mealAnalysisSchema,
    });

    const sent = mock.last();
    const user = sent.messages.at(-1)!;
    const parts = user.content as { type: string; image_url?: { url: string; detail: string } }[];
    expect(user.role).toBe("user");
    expect(parts[0].type).toBe("image_url");
    expect(parts[0].image_url!.url).toBe(JPEG_DATA_URL);
    expect(parts[0].image_url!.detail).toBe(MEAL_IMAGE_DETAIL);
    // Portion estimation is the one call the app cannot recompute later, so it
    // must not be sent at the 512px "low" tier.
    expect(MEAL_IMAGE_DETAIL).toBe("high");
  });

  it("works with a note and no photo at all", async () => {
    mock.next = { kind: "json", content: MEAL_REPLY };
    await llm.structured({
      model: MODELS.mealAnalyze,
      messages: mealMessages("", undefined, "2 eggs, 3 strips bacon, black coffee"),
      schemaName: "meal_analysis",
      jsonSchema: JSON_SCHEMAS.meal_analysis,
      validator: mealAnalysisSchema,
    });
    const parts = mock.last().messages.at(-1)!.content as { type: string }[];
    expect(parts.map((p) => p.type)).toEqual(["text"]);
  });

  it("keeps goals at the very front of the cached prefix", async () => {
    const messages = mealMessages("Running prep. Shoulders and back.", JPEG_DATA_URL, "note");
    expect(messages[0].role).toBe("system");
    expect(messages[0].content as string).toMatch(/^THE PERSON'S STATED GOALS/);
  });
});

describe("the other routes' request shapes", () => {
  it("set parsing sends the shorthand rules as a plain system string", async () => {
    mock.next = { kind: "json", content: JSON.stringify({ entries: [] }) };
    await llm.structured({
      model: MODELS.setsParse,
      messages: [{ role: "system", content: SETS_SYSTEM }, { role: "user", content: "bench 5x5 185" }],
      schemaName: "parsed_sets",
      jsonSchema: JSON_SCHEMAS.parsed_sets,
      validator: parsedSetsSchema,
    });
    expect(mock.last().model).toBe(MODELS.setsParse);
    expect(typeof mock.last().messages[0].content).toBe("string");
  });

  it("the progression suggestion is capped tightly enough for a rest period", async () => {
    mock.next = { kind: "json", content: JSON.stringify({
      weight_lb: 190, sets: 3, reps: 5, reason: "Last session was RPE 7 throughout.",
    }) };
    await llm.structured({
      model: MODELS.sessionSuggest,
      messages: [{ role: "system", content: SUGGEST_SYSTEM }, { role: "user", content: "baseline 185" }],
      schemaName: "suggestion",
      jsonSchema: JSON_SCHEMAS.suggestion,
      validator: suggestionSchema,
      maxTokens: 300,
    });
    expect(mock.last().max_completion_tokens).toBe(300);
  });

  it("session ask and coach chat stream deltas", async () => {
    mock.next = { kind: "stream", chunks: ["You're ", "38g under ", "protein."] };
    const out: string[] = [];
    for await (const chunk of llm.stream({
      model: MODELS.sessionAsk,
      messages: [{ role: "system", content: COACH_VOICE }, { role: "user", content: "another set?" }],
      maxTokens: 400,
    })) out.push(chunk);

    expect(out.join("")).toBe("You're 38g under protein.");
    expect(mock.last().stream).toBe(true);
    expect(mock.last().max_completion_tokens).toBe(400);
  });

  it("the digests use the non-streaming text path", async () => {
    mock.next = { kind: "text", content: "You're 38g under protein for the fourth day. Add a shake tonight." };
    const verdict = await llm.text({
      model: MODELS.digest,
      messages: [{ role: "system", content: COACH_VOICE }, { role: "user", content: stableJson({ kcal: 1840 }) }],
      maxTokens: 200,
    });
    expect(verdict).toMatch(/38g under protein/);
    expect(mock.last().stream).toBeUndefined();
  });
});

describe("failure modes", () => {
  it("surfaces a refusal instead of reporting an empty response", async () => {
    mock.next = { kind: "refusal", refusal: "I can't help with that." };
    await expect(llm.structured({
      model: "test-model",
      messages: [{ role: "user", content: "u" }],
      schemaName: "meal_analysis",
      jsonSchema: JSON_SCHEMAS.meal_analysis,
      validator: mealAnalysisSchema,
    })).rejects.toThrow(/declined.*I can't help with that/);
  });

  it("names truncation rather than blaming the JSON", async () => {
    mock.next = { kind: "truncated", content: '{"items":[{"name":"Chick' };
    await expect(llm.structured({
      model: "test-model",
      messages: [{ role: "user", content: "u" }],
      schemaName: "meal_analysis",
      jsonSchema: JSON_SCHEMAS.meal_analysis,
      validator: mealAnalysisSchema,
      maxTokens: 16,
    })).rejects.toThrow(/truncated at 16 tokens/);
  });

  it("rejects a well-formed response that violates the zod contract", async () => {
    mock.next = { kind: "json", content: JSON.stringify({ items: [], confidence: 7, note: "" }) };
    await expect(llm.structured({
      model: "test-model",
      messages: [{ role: "user", content: "u" }],
      schemaName: "meal_analysis",
      jsonSchema: JSON_SCHEMAS.meal_analysis,
      validator: mealAnalysisSchema,
    })).rejects.toThrow(/did not match schema/);
  });

  it("wraps a server error as an LlmError so callers can fall back", async () => {
    mock.next = { kind: "error", status: 429, message: "Rate limit reached" };
    await expect(llm.text({ model: "test-model", messages: [{ role: "user", content: "u" }] }))
      .rejects.toBeInstanceOf(LlmError);
  });
});

describe("prompt-cache discipline", () => {
  it("produces a byte-identical prefix for the same context", () => {
    const a = stableJson({ b: 2, a: [{ z: 1, y: 2 }] });
    const b = stableJson({ a: [{ y: 2, z: 1 }], b: 2 });
    expect(a).toBe(b);
  });

  it("keeps the volatile question out of the cached system prefix", async () => {
    mock.next = { kind: "stream", chunks: ["ok"] };
    const prefix = `${COACH_VOICE}\n\nHISTORY: ${stableJson({ bench: [185, 190] })}`;
    for await (const _ of llm.stream({
      model: MODELS.sessionAsk,
      messages: [{ role: "system", content: prefix }, { role: "user", content: "QUESTION: another set?" }],
    })) { /* drain */ }

    const sent = mock.last();
    expect(sent.messages[0].content).toBe(prefix);
    expect(String(sent.messages.at(-1)!.content)).toContain("QUESTION:");
  });
});

/**
 * A contract test is only worth the failures it can produce. These assert the
 * stand-in rejects the mistakes it exists to catch — without them, every test
 * above would still pass against a mock that accepted anything.
 */
describe("the harness rejects what the real API rejects", () => {
  const send = (jsonSchema: object) => llm.structured({
    model: "test-model",
    messages: [{ role: "user", content: "u" }],
    schemaName: "suggestion",
    jsonSchema,
    validator: suggestionSchema,
  });

  it("rejects an object that allows additional properties", async () => {
    await expect(send({
      type: "object",
      properties: { weight_lb: { type: "number" } },
      required: ["weight_lb"],
    })).rejects.toThrow(/additionalProperties/);
  });

  it("rejects a property that is missing from required", async () => {
    await expect(send({
      type: "object",
      properties: { weight_lb: { type: "number" }, reason: { type: "string" } },
      required: ["weight_lb"],
      additionalProperties: false,
    })).rejects.toThrow(/required/);
  });

  it("rejects keywords strict mode does not support", async () => {
    await expect(send({
      type: "object",
      properties: { reason: { type: "string", maxLength: 200 } },
      required: ["reason"],
      additionalProperties: false,
    })).rejects.toThrow(/maxLength/);
  });

  it("rejects an image attached to a system message", async () => {
    mock.next = { kind: "text", content: "unreachable" };
    await expect(llm.text({
      model: "test-model",
      messages: [{
        role: "system",
        content: [{ type: "image_url", image_url: { url: JPEG_DATA_URL } }],
      }],
    })).rejects.toThrow(/images are only allowed on user messages/);
  });

  it("rejects an image_url that is neither a URL nor a data URI", async () => {
    mock.next = { kind: "text", content: "unreachable" };
    await expect(llm.text({
      model: "test-model",
      messages: [{
        role: "user",
        content: [{ type: "image_url", image_url: { url: "/tmp/meal.jpg" } }],
      }],
    })).rejects.toThrow(/must be a URL or a data:image/);
  });
});

import { OpenAiProvider } from "./openai";
import { FixtureProvider } from "./fixtures";
import type { LlmProvider } from "./provider";

let cached: LlmProvider | null = null;

/**
 * Falls back to fixtures rather than throwing when no key is configured.
 *
 * That's deliberate: a missing key should degrade the app to "the coach is
 * offline", not take down meal logging and the whole session flow with it.
 */
export function getLlm(): LlmProvider {
  if (cached) return cached;

  const key = process.env.OPENAI_API_KEY;
  const forced = process.env.LLM_PROVIDER;

  if (forced === "fixtures" || !key) {
    if (!key && forced !== "fixtures") {
      console.warn("[llm] OPENAI_API_KEY not set — using offline fixtures.");
    }
    cached = new FixtureProvider();
  } else {
    cached = new OpenAiProvider(key);
  }
  return cached;
}

export const isOffline = (): boolean => getLlm().name === "fixtures";

export * from "./provider";
export * from "./schemas";

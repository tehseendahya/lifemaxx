import OpenAI, { APIError } from "openai";
import { LlmError } from "./provider";
import { MODELS } from "@/lib/models";

/**
 * Speech to text.
 *
 * Separate from `LlmProvider` because it is a different endpoint with a
 * different shape — audio in, a bare string out, no schema and no streaming —
 * but it follows the same two-implementation pattern on purpose: a real
 * provider and a fixtures provider, chosen the same way `getLlm()` chooses, so
 * `LLM_PROVIDER=fixtures` demonstrates the whole voice flow end to end with no
 * key and no network.
 *
 * Nothing here persists anything. The audio exists as a `File` in memory for
 * one request and is dropped, the same rule meal photos follow.
 */

export interface Transcriber {
  readonly name: string;
  transcribe(input: { file: File; hint?: string }): Promise<string>;
}

/** Twenty seconds. The clip is fifteen at most and the user is standing still. */
const TIMEOUT_MS = 20_000;

/**
 * The fixture transcript is shorthand, not prose, and that is load-bearing.
 *
 * `FixtureProvider.structured` implements `parsed_sets` by running the real
 * `parseShorthand` over its input. A prose fixture would therefore come back
 * with zero entries and the offline demo would look like a broken parser rather
 * than a working flow. "bench 5x5 185" parses deterministically into five sets,
 * which is the whole flow proven with no model anywhere in it.
 */
export const FIXTURE_TRANSCRIPT = "bench 5x5 185";

class FixtureTranscriber implements Transcriber {
  readonly name = "fixtures";

  async transcribe(): Promise<string> {
    return FIXTURE_TRANSCRIPT;
  }
}

/**
 * Pulls the reason out of an SDK error.
 *
 * Same reasoning as `describe` in openai.ts: a 400 from this endpoint is the
 * actionable class — an unknown model id, an unsupported container, a file the
 * API could not decode — and the reason is in the response body. Logging
 * "transcription failed" and leaving the body on `cause` means the one line
 * that says what to fix never reaches the log.
 */
function describe(err: unknown): string {
  if (err instanceof APIError) {
    const body = err.error as { message?: string } | undefined;
    return `${err.status ?? "network"}: ${body?.message ?? err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

class OpenAiTranscriber implements Transcriber {
  readonly name = "openai";
  private client: OpenAI;

  constructor(apiKey: string, options: { baseURL?: string; maxRetries?: number } = {}) {
    this.client = new OpenAI({
      apiKey,
      baseURL: options.baseURL,
      timeout: TIMEOUT_MS,
      // One retry, not the SDK's two. A user is standing in a gym waiting; a
      // third attempt is past the point where they would rather type it.
      maxRetries: options.maxRetries ?? 1,
    });
  }

  async transcribe({ file, hint }: { file: File; hint?: string }): Promise<string> {
    const model = MODELS.transcribe;
    // The route checks `isTranscriptionConfigured()` first and answers 503, so
    // reaching here with no model means a new caller skipped that check.
    if (model === null) throw new LlmError("No transcription model is configured");

    try {
      const text = await this.client.audio.transcriptions.create(
        {
          file,
          model,
          // The app is English-only and saying so removes language detection
          // from the decode, which is both faster and stops "bench" in a noisy
          // room being read as another language's word.
          language: "en",
          // The current exercise name, used as a decoding prompt. It is what
          // makes "weighted pull ups" come back as those words rather than
          // "weighted pull-up's" or "weighted pollups".
          prompt: hint,
          // A bare string back, not a JSON envelope. Nothing downstream wants
          // segments, logprobs or durations.
          response_format: "text",
        },
        { timeout: TIMEOUT_MS },
      );

      return text.trim();
    } catch (err) {
      throw new LlmError(`OpenAI transcription failed — ${describe(err)}`, err);
    }
  }
}

let cached: Transcriber | null = null;
let injected: Transcriber | null = null;

/**
 * A seam for the tests, matching the one `src/lib/auth/bearer.ts` uses.
 *
 * There is no way to point `getTranscriber()` at a stand-in through
 * configuration — the base URL is not an env var — and a test that reaches
 * api.openai.com is not a test. Pass `null` to restore the real selection.
 */
export function setTranscriber(transcriber: Transcriber | null): void {
  injected = transcriber;
  cached = null;
}

/**
 * Fixtures when there is no key, exactly like `getLlm()`.
 *
 * Degrading rather than throwing is the established choice in this repo: a
 * missing key should mean "the coach is offline", not a 500 from a route that
 * had nothing to do with the key.
 */
export function getTranscriber(): Transcriber {
  if (injected) return injected;
  if (cached) return cached;

  const key = process.env.OPENAI_API_KEY;
  const forced = process.env.LLM_PROVIDER;

  cached = forced === "fixtures" || !key
    ? new FixtureTranscriber()
    : new OpenAiTranscriber(key);

  return cached;
}

/**
 * Whether speaking a set can work at all right now.
 *
 * The fixtures transcriber needs nothing, so the offline demo path is always
 * available. The real one needs a model id, and there is deliberately no
 * default for it (see `MODELS.transcribe`) — so this is the check that turns an
 * unconfigured deployment into a 503 the client can explain, rather than a 400
 * from OpenAI that looks like a bug in the upload.
 */
export function isTranscriptionConfigured(): boolean {
  return getTranscriber().name === "fixtures" || MODELS.transcribe !== null;
}

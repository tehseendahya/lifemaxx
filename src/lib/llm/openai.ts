import OpenAI, { APIError } from "openai";
import { LlmError, type LlmProvider, type Message, type StructuredRequest, type TextRequest } from "./provider";

/**
 * The real provider.
 *
 * Note there is no cache configuration here: OpenAI caches automatically above
 * ~1024 tokens. The work of making caching pay off happens in prompt assembly
 * (see prompts.ts) by keeping the prefix byte-stable, not by anything set here.
 *
 * What is set here is the failure budget. The SDK defaults to a ten-minute
 * timeout, which is the wrong number for every route in this app — the longest
 * anything here is worth waiting for is a meal photo, and the shortest is a
 * question asked on ninety seconds of rest between sets.
 */

/** Ten minutes is the SDK default. Nothing here is worth waiting that long for. */
const DEFAULT_TIMEOUT_MS = 45_000;

export interface OpenAiOptions {
  /** Overridden in tests to point at a contract-checking stand-in. */
  baseURL?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * Pulls the reason out of an SDK error.
 *
 * A 400 from this API is the actionable class — a schema strict mode won't
 * accept, a model id that doesn't exist, a parameter renamed out from under
 * you — and the reason is in the response body. Reporting "OpenAI request
 * failed" and leaving that body on `cause` means the one line that says what
 * to fix never reaches the log.
 */
function describe(err: unknown): string {
  if (err instanceof APIError) {
    const body = err.error as { message?: string } | undefined;
    return `${err.status ?? "network"}: ${body?.message ?? err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";
  private client: OpenAI;
  private defaultTimeoutMs: number;

  constructor(apiKey: string, options: OpenAiOptions = {}) {
    this.defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.client = new OpenAI({
      apiKey,
      baseURL: options.baseURL,
      timeout: this.defaultTimeoutMs,
      maxRetries: options.maxRetries ?? 2,
    });
  }

  private toChatMessages(messages: Message[]) {
    return messages.map((m) => ({ role: m.role, content: m.content })) as any;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    let raw: string | null | undefined;
    try {
      const res = await this.client.chat.completions.create(
        {
          model: req.model,
          messages: this.toChatMessages(req.messages),
          max_completion_tokens: req.maxTokens ?? 2000,
          response_format: {
            type: "json_schema",
            json_schema: { name: req.schemaName, schema: req.jsonSchema as any, strict: true },
          },
        },
        { timeout: req.timeoutMs ?? this.defaultTimeoutMs },
      );

      const choice = res.choices[0];

      // Structured outputs put a safety decline in `refusal`, not `content`,
      // and leave content null. Without this the caller sees "empty response"
      // and has no idea the model actually said something.
      if (choice?.message?.refusal) {
        throw new LlmError(`Model declined ${req.schemaName}: ${choice.message.refusal}`);
      }

      // A completion cut off by the token cap returns JSON that is syntactically
      // incomplete. That reads as a parse failure three lines down, which sends
      // you looking at the schema instead of at max_completion_tokens.
      if (choice?.finish_reason === "length") {
        throw new LlmError(
          `Response for ${req.schemaName} was truncated at ${req.maxTokens ?? 2000} tokens — raise maxTokens`,
        );
      }

      raw = choice?.message?.content;
    } catch (err) {
      if (err instanceof LlmError) throw err;
      throw new LlmError(`OpenAI request failed for ${req.schemaName} — ${describe(err)}`, err);
    }

    if (!raw) throw new LlmError(`Empty response for ${req.schemaName}`);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new LlmError(`Response for ${req.schemaName} was not valid JSON`, err);
    }

    const result = req.validator.safeParse(parsed);
    if (!result.success) {
      throw new LlmError(`Response for ${req.schemaName} did not match schema: ${result.error.message}`);
    }
    return result.data;
  }

  async text(req: TextRequest): Promise<string> {
    try {
      const res = await this.client.chat.completions.create(
        {
          model: req.model,
          messages: this.toChatMessages(req.messages),
          max_completion_tokens: req.maxTokens ?? 800,
        },
        { timeout: req.timeoutMs ?? this.defaultTimeoutMs },
      );
      const choice = res.choices[0];
      if (choice?.message?.refusal) {
        throw new LlmError(`Model declined: ${choice.message.refusal}`);
      }
      return choice?.message?.content ?? "";
    } catch (err) {
      if (err instanceof LlmError) throw err;
      throw new LlmError(`OpenAI text request failed — ${describe(err)}`, err);
    }
  }

  async *stream(req: TextRequest): AsyncIterable<string> {
    let s: Awaited<ReturnType<typeof this.client.chat.completions.create>>;
    try {
      s = await this.client.chat.completions.create(
        {
          model: req.model,
          messages: this.toChatMessages(req.messages),
          max_completion_tokens: req.maxTokens ?? 800,
          stream: true,
        },
        { timeout: req.timeoutMs ?? this.defaultTimeoutMs },
      );
    } catch (err) {
      throw new LlmError(`OpenAI stream failed — ${describe(err)}`, err);
    }

    // Iterating is outside the try above on purpose: a throw from inside a
    // generator's try block that also yields swallows the partial output the
    // caller has already received and streamed to the screen.
    try {
      for await (const chunk of s as AsyncIterable<any>) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    } catch (err) {
      throw new LlmError(`OpenAI stream interrupted — ${describe(err)}`, err);
    }
  }
}

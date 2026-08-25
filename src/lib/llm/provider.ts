import type { z } from "zod";

/**
 * The seam between the app and whichever model provider is behind it.
 *
 * Two implementations: `openai` (real) and `fixtures` (deterministic, offline).
 * Every caller goes through this interface, so the whole app — including meal
 * capture and the in-session coach — runs end to end with no API key and no
 * network. That also makes the routes testable without recording HTTP.
 */

export interface Message {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export interface StructuredRequest<T> {
  model: string;
  messages: Message[];
  schemaName: keyof typeof import("./schemas").JSON_SCHEMAS;
  jsonSchema: object;
  validator: z.ZodType<T>;
  maxTokens?: number;
}

export interface TextRequest {
  model: string;
  messages: Message[];
  maxTokens?: number;
}

export interface LlmProvider {
  readonly name: string;
  structured<T>(req: StructuredRequest<T>): Promise<T>;
  text(req: TextRequest): Promise<string>;
  stream(req: TextRequest): AsyncIterable<string>;
}

export class LlmError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "LlmError";
  }
}

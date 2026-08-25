import OpenAI from "openai";
import { LlmError, type LlmProvider, type Message, type StructuredRequest, type TextRequest } from "./provider";

/**
 * The real provider.
 *
 * Note there is no cache configuration here: OpenAI caches automatically above
 * ~1024 tokens. The work of making caching pay off happens in prompt assembly
 * (see prompts.ts) by keeping the prefix byte-stable, not by anything set here.
 */
export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  private toChatMessages(messages: Message[]) {
    return messages.map((m) => ({ role: m.role, content: m.content })) as any;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    let raw: string | null | undefined;
    try {
      const res = await this.client.chat.completions.create({
        model: req.model,
        messages: this.toChatMessages(req.messages),
        max_completion_tokens: req.maxTokens ?? 2000,
        response_format: {
          type: "json_schema",
          json_schema: { name: req.schemaName, schema: req.jsonSchema as any, strict: true },
        },
      });
      raw = res.choices[0]?.message?.content;
    } catch (err) {
      throw new LlmError(`OpenAI request failed for ${req.schemaName}`, err);
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
      const res = await this.client.chat.completions.create({
        model: req.model,
        messages: this.toChatMessages(req.messages),
        max_completion_tokens: req.maxTokens ?? 800,
      });
      return res.choices[0]?.message?.content ?? "";
    } catch (err) {
      throw new LlmError("OpenAI text request failed", err);
    }
  }

  async *stream(req: TextRequest): AsyncIterable<string> {
    try {
      const s = await this.client.chat.completions.create({
        model: req.model,
        messages: this.toChatMessages(req.messages),
        max_completion_tokens: req.maxTokens ?? 800,
        stream: true,
      });
      for await (const chunk of s) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
    } catch (err) {
      throw new LlmError("OpenAI stream failed", err);
    }
  }
}

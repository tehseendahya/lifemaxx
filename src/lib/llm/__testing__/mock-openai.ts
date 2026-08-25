import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

/**
 * A stand-in for api.openai.com that enforces the documented contract.
 *
 * This exists because api.openai.com is blocked by this environment's egress
 * policy, so no request the app builds had ever been seen by anything that
 * would reject it. The mock is deliberately strict: it validates the request
 * the way the real endpoint does — the structured-outputs schema subset, the
 * message content shapes, the token parameter names — and fails loudly rather
 * than politely returning something plausible.
 *
 * It cannot tell you whether a model id exists or whether the model's answers
 * are any good. It can tell you that every field the app sends is one the API
 * accepts, and that every response shape the API can return is one the app
 * survives — including the two that are easy to forget: a refusal, and a
 * completion truncated by max_completion_tokens.
 */

export interface CapturedRequest {
  model: string;
  messages: { role: string; content: unknown }[];
  response_format?: { type: string; json_schema?: { name: string; schema: object; strict?: boolean } };
  max_completion_tokens?: number;
  max_tokens?: number;
  stream?: boolean;
  [key: string]: unknown;
}

export type Reply =
  | { kind: "json"; content: string }
  | { kind: "refusal"; refusal: string }
  | { kind: "truncated"; content: string }
  | { kind: "text"; content: string }
  | { kind: "stream"; chunks: string[] }
  | { kind: "error"; status: number; message: string };

export class MockOpenAI {
  private server: Server;
  readonly requests: CapturedRequest[] = [];
  /** Set before each call to decide what comes back. */
  next: Reply = { kind: "text", content: "ok" };
  baseURL = "";

  constructor() {
    this.server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        if (!req.url?.endsWith("/chat/completions")) {
          res.writeHead(404).end(JSON.stringify({ error: { message: "no such route" } }));
          return;
        }

        let body: CapturedRequest;
        try {
          body = JSON.parse(raw);
        } catch {
          res.writeHead(400).end(JSON.stringify({ error: { message: "invalid JSON body" } }));
          return;
        }
        this.requests.push(body);

        const rejection = validate(body);
        if (rejection) {
          res.writeHead(400, { "Content-Type": "application/json" })
            .end(JSON.stringify({ error: { message: rejection, type: "invalid_request_error" } }));
          return;
        }

        this.respond(res, body);
      });
    });
  }

  private respond(res: import("node:http").ServerResponse, body: CapturedRequest) {
    const reply = this.next;

    if (reply.kind === "error") {
      res.writeHead(reply.status, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: { message: reply.message, type: "server_error" } }));
      return;
    }

    if (body.stream) {
      const chunks = reply.kind === "stream" ? reply.chunks : ["ok"];
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const text of chunks) {
        res.write(`data: ${JSON.stringify({
          id: "chatcmpl-mock", object: "chat.completion.chunk", created: 0, model: body.model,
          choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
        })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({
        id: "chatcmpl-mock", object: "chat.completion.chunk", created: 0, model: body.model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    }

    const message =
      reply.kind === "refusal"
        ? { role: "assistant", content: null, refusal: reply.refusal }
        : { role: "assistant", content: "content" in reply ? reply.content : "", refusal: null };

    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
      id: "chatcmpl-mock",
      object: "chat.completion",
      created: 0,
      model: body.model,
      choices: [{
        index: 0,
        message,
        logprobs: null,
        finish_reason: reply.kind === "truncated" ? "length" : reply.kind === "refusal" ? "stop" : "stop",
      }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    }));
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    this.baseURL = `http://127.0.0.1:${port}/v1`;
    return this.baseURL;
  }

  async stop() {
    await new Promise<void>((resolve, reject) =>
      this.server.close((err) => (err ? reject(err) : resolve())));
  }

  last(): CapturedRequest {
    const req = this.requests.at(-1);
    if (!req) throw new Error("no request captured");
    return req;
  }
}

/** Returns an error string if the request would be rejected by the real API. */
function validate(body: CapturedRequest): string | null {
  if (typeof body.model !== "string" || body.model.length === 0) return "'model' is required";
  if (!Array.isArray(body.messages) || body.messages.length === 0) return "'messages' is required";

  if ("max_tokens" in body && body.max_tokens !== undefined) {
    // Not fatal at the API, but it is the deprecated spelling and is rejected
    // outright by the reasoning models. Treat it as an error here so the app
    // can never quietly regress to it.
    return "'max_tokens' is deprecated; use 'max_completion_tokens'";
  }

  for (const [i, message] of body.messages.entries()) {
    if (!["system", "user", "assistant", "tool", "developer"].includes(message.role)) {
      return `messages[${i}].role '${message.role}' is not a valid role`;
    }
    if (typeof message.content === "string") continue;
    if (!Array.isArray(message.content)) return `messages[${i}].content must be a string or an array`;

    for (const [j, part] of (message.content as Record<string, unknown>[]).entries()) {
      const path = `messages[${i}].content[${j}]`;
      if (part.type === "text") {
        if (typeof part.text !== "string") return `${path}.text must be a string`;
      } else if (part.type === "image_url") {
        const image = part.image_url as { url?: unknown; detail?: unknown } | undefined;
        if (!image || typeof image.url !== "string") return `${path}.image_url.url must be a string`;
        if (!/^(https?:\/\/|data:image\/)/.test(image.url)) {
          return `${path}.image_url.url must be a URL or a data:image/... URI`;
        }
        if (image.detail !== undefined && !["low", "high", "auto"].includes(image.detail as string)) {
          return `${path}.image_url.detail must be one of low, high, auto`;
        }
        if (message.role !== "user") return `${path}: images are only allowed on user messages`;
      } else {
        return `${path}.type '${String(part.type)}' is not a supported content part`;
      }
    }
  }

  const format = body.response_format;
  if (format && format.type === "json_schema") {
    if (!format.json_schema) return "response_format.json_schema is required when type is json_schema";
    const { name, schema, strict } = format.json_schema;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name ?? "")) {
      return `response_format.json_schema.name '${name}' must match ^[a-zA-Z0-9_-]{1,64}$`;
    }
    if (strict === true) {
      const problem = validateStrictSchema(schema, "schema");
      if (problem) return problem;
    }
  }

  return null;
}

/**
 * The subset of JSON Schema that structured outputs accepts with strict: true.
 * Getting any of this wrong is a 400 at request time, not a bad answer — which
 * is exactly the class of bug that cannot be caught without talking to
 * something that checks.
 */
function validateStrictSchema(node: unknown, path: string): string | null {
  if (!node || typeof node !== "object") return `${path} must be an object`;
  const s = node as Record<string, unknown>;

  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (types.includes("object")) {
    if (s.additionalProperties !== false) {
      return `${path}: strict mode requires "additionalProperties": false`;
    }
    const properties = (s.properties ?? {}) as Record<string, unknown>;
    const keys = Object.keys(properties);
    const required = (s.required ?? []) as string[];
    const missing = keys.filter((k) => !required.includes(k));
    if (missing.length > 0) {
      return `${path}: strict mode requires every property in "required" — missing ${missing.join(", ")}`;
    }
    for (const [key, value] of Object.entries(properties)) {
      const problem = validateStrictSchema(value, `${path}.${key}`);
      if (problem) return problem;
    }
  }

  if (types.includes("array")) {
    if (!s.items) return `${path}: array schemas need "items"`;
    const problem = validateStrictSchema(s.items, `${path}[]`);
    if (problem) return problem;
  }

  for (const keyword of ["minLength", "maxLength", "pattern", "minimum", "maximum", "format", "default"]) {
    if (keyword in s) return `${path}: "${keyword}" is not supported in strict mode`;
  }

  return null;
}

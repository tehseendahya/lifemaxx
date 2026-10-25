// `expo/fetch` is a WinterCG implementation shipped inside the `expo` package.
// It is imported under a distinct name so the two are never confused: the
// global `fetch` in React Native is XHR-backed and leaves `response.body`
// undefined, which makes a streaming route look like it hangs and then dumps
// everything at the end. Only `streamingFetch` can read a stream.
import { fetch as streamingFetch } from "expo/fetch";

import { apiBaseUrl } from "./config";
import { accessToken, signOut } from "./auth";

/**
 * Every call to the Next.js API goes through here.
 *
 * The one thing this file exists for is the `Authorization: Bearer` header. The
 * web app authenticates from Supabase SSR cookies, which a native client does
 * not have; without the bearer token every request resolves to no user and
 * every screen renders empty.
 */

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Long enough to survive a cold serverless start on bad reception, short enough
 * that a dead connection does not leave a spinner on screen indefinitely.
 * Uploads get longer because they carry audio over cell data.
 */
const TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 30_000;

function url(path: string): string {
  const base = apiBaseUrl();
  if (base === "") {
    throw new ApiError(
      0,
      "No API URL is set. Add one in You → Connection, or set expo.extra.apiBaseUrl.",
    );
  }
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await accessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// --------------------------------------------------------------------- 401

type UnauthorizedHandler = () => void;

let onUnauthorized: UnauthorizedHandler | null = null;
let signingOut = false;

/**
 * Registered once by the root layout, which owns navigation.
 *
 * This module cannot navigate on its own without importing expo-router, and a
 * data layer that performs navigation as a side effect is very hard to reason
 * about when six screens are refetching at once.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

/**
 * A 401 means the session is gone, and a screen in view usually has three or
 * four queries in flight at once — so this must happen once, not once per
 * failed request, or the user gets bounced to sign-in repeatedly and any error
 * they were reading is replaced mid-sentence.
 */
function handleUnauthorized(): void {
  if (signingOut) return;
  signingOut = true;

  void signOut().finally(() => {
    onUnauthorized?.();
    // Released once the sign-out has actually settled, so a burst of parallel
    // 401s collapses into one redirect but a genuinely new 401 later still
    // works.
    signingOut = false;
  });
}

// ------------------------------------------------------------------ helpers

async function describe(res: Response): Promise<string> {
  // Routes report failures as `{ error: "..." }` (see `jsonError` in
  // src/lib/api.ts). Falling back to the status text keeps the message useful
  // when the failure happened before the handler ran — a platform 502, say.
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error !== "") return body.error;
  } catch {
    /* not JSON */
  }
  return res.statusText || `Request failed with ${res.status}`;
}

async function request<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number = TIMEOUT_MS,
): Promise<T> {
  const target = url(path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(target, {
      ...init,
      signal: controller.signal,
      headers: { ...(await authHeaders()), ...(init.headers as Record<string, string>) },
    });
  } catch (err) {
    // An abort is the timeout firing, not a user action — there is no cancel
    // button anywhere in this app — so it is reported as a timeout.
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(0, "The request timed out.");
    }
    throw new ApiError(0, err instanceof Error ? err.message : "Network error");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) {
    handleUnauthorized();
    throw new ApiError(401, "Your session expired. Sign in again.");
  }

  if (!res.ok) throw new ApiError(res.status, await describe(res));

  // 204, or a route that returns nothing.
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (text === "") return undefined as T;
  return JSON.parse(text) as T;
}

// ------------------------------------------------------------------- public

export async function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Multipart upload — currently one caller, the voice recorder.
 *
 * `Content-Type` is deliberately not set. React Native generates the multipart
 * boundary while serialising the FormData, and it can only put that boundary in
 * the header if it is writing the header. Setting `multipart/form-data` by hand
 * produces a request whose declared boundary does not match its body, which the
 * server rejects as a malformed upload.
 */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  return request<T>(path, { method: "POST", body: form }, UPLOAD_TIMEOUT_MS);
}

/**
 * Reads a `text/plain` streaming route chunk by chunk.
 *
 * This is the one place that must use `expo/fetch`. React Native's global
 * fetch is implemented on XMLHttpRequest, which has no streaming body, so
 * `response.body` is undefined and the coach's reply would sit invisible until
 * the route finished and then appear all at once — the opposite of the point.
 *
 * If `response.body` is missing anyway (an older runtime, or a proxy that
 * buffers), it falls back to reading the whole body and emitting it as a single
 * chunk. The reply arrives late rather than not at all.
 */
export async function apiStream(
  path: string,
  body: unknown,
  onChunk: (s: string) => void,
): Promise<void> {
  const target = url(path);

  let res: Awaited<ReturnType<typeof streamingFetch>>;
  try {
    res = await streamingFetch(target, {
      method: "POST",
      headers: {
        ...(await authHeaders()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError(0, err instanceof Error ? err.message : "Network error");
  }

  if (res.status === 401) {
    handleUnauthorized();
    throw new ApiError(401, "Your session expired. Sign in again.");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = res.statusText || `Request failed with ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error !== "") message = parsed.error;
    } catch {
      if (text !== "") message = text.slice(0, 200);
    }
    throw new ApiError(res.status, message);
  }

  const stream = res.body;
  if (!stream) {
    const text = await res.text();
    if (text !== "") onChunk(text);
    return;
  }

  const reader = stream.getReader();
  // `stream: true` matters: a multi-byte character split across two network
  // chunks would otherwise decode as a replacement character on each side of
  // the boundary.
  const decoder = new TextDecoder();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text !== "") onChunk(text);
    }
    const tail = decoder.decode();
    if (tail !== "") onChunk(tail);
  } finally {
    reader.releaseLock();
  }
}

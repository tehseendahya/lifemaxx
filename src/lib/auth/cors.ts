/**
 * CORS, for exactly one caller.
 *
 * React Native's `fetch` is not a browser fetch and is not subject to the
 * same-origin policy, so the phone needs none of this. It exists for the one
 * place the native code is looked at in a browser: Expo's web target
 * (`npx expo start --web`, origin http://localhost:8081), used as a rough
 * visual smoke test of pure-RN components.
 *
 * So the allowlist is empty by default and the headers are absent entirely
 * unless an origin is named in MOBILE_CORS_ORIGINS. Never `*`, and never
 * `Access-Control-Allow-Credentials`: the native path is bearer-only, and a
 * wildcard origin on a route that also accepts session cookies is how a
 * same-origin cookie becomes a cross-origin one.
 */

/** Read at call time, not module load, so a test can set it per case. */
export function corsAllowlist(): string[] {
  return (process.env.MOBILE_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  if (!corsAllowlist().includes(origin)) return {};

  return {
    // The exact origin that asked, echoed back — the only correct value when
    // the allowlist has more than one entry in it.
    "Access-Control-Allow-Origin": origin,
    // And therefore the response is origin-dependent, which any cache in front
    // of it has to be told or it will serve one origin's headers to another.
    Vary: "Origin",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  };
}

export function corsHeadersFor(req: Request): Record<string, string> {
  return corsHeaders(req.headers.get("origin"));
}

/**
 * The `OPTIONS` handler for routes the native client talks to.
 *
 * A non-allowlisted origin still gets a 204 — OPTIONS genuinely is allowed
 * here — but with no CORS headers, which is what makes the browser refuse the
 * real request. Answering 403 instead would say the same thing less clearly
 * and look like an outage in the network tab.
 */
export function preflight(req: Request): Response {
  const headers = corsHeadersFor(req);
  const allowed = Object.keys(headers).length > 0;
  return new Response(null, {
    status: 204,
    headers: allowed ? { ...headers, "Access-Control-Max-Age": "600" } : {},
  });
}

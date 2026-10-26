import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/push/subscribe` from the Expo web client, which has no cookie and
 * sends a bearer token. The real `currentUser` resolution runs here — only the
 * token verifier is swapped — so this pins that the route really goes through
 * the bearer path rather than a mock of it.
 */

const values = vi.fn();
const onConflictDoUpdate = vi.fn();
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        values(v);
        return { onConflictDoUpdate: async (c: unknown) => onConflictDoUpdate(c) };
      },
    }),
  },
  withUser: <T>(_userId: string, fn: () => Promise<T>): Promise<T> => fn(),
}));
vi.mock("@/lib/queries", () => ({
  getProfile: async () => ({ tz: "America/New_York" }),
  localDate: () => "2026-10-26",
}));
// Reached only if the bearer path were skipped; failing loudly proves it is not.
vi.mock("next/headers", () => ({
  cookies: async () => { throw new Error("cookies() must not be read on a bearer request"); },
}));

const { POST } = await import("./route");
const { setVerifier } = await import("@/lib/auth/bearer");

const USER = "6f1c2b9e-3a4d-4e5f-8a7b-0c1d2e3f4a5b";
const SUB = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };

function post(authorization: string, body: unknown = SUB) {
  return POST(new Request("https://lifemaxx.example/api/push/subscribe", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  values.mockReset();
  onConflictDoUpdate.mockReset();
  setVerifier(async (token) => (token === "good" ? { id: USER, email: "" } : null));
});

afterEach(() => setVerifier(null));

describe("POST /api/push/subscribe with a bearer token", () => {
  it("stores the subscription for the token's user", async () => {
    const res = await post("Bearer good");
    expect(res.status).toBe(200);
    expect(values).toHaveBeenCalledWith({ userId: USER, endpoint: SUB.endpoint, p256dh: "p", auth: "a" });
  });

  it("401s an invalid token without falling back to cookies", async () => {
    const res = await post("Bearer bad");
    expect(res.status).toBe(401);
    expect(values).not.toHaveBeenCalled();
  });

  it("400s a body that is not a subscription", async () => {
    const res = await post("Bearer good", { endpoint: SUB.endpoint, keys: { p256dh: "p" } });
    expect(res.status).toBe(400);
    expect(values).not.toHaveBeenCalled();
  });
});

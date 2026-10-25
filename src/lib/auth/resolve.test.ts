import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Resolution order is the whole of this workstream's security surface.
 *
 * The expensive mistake is a fall-through: a bad bearer token that quietly
 * authenticates as the cookie session or as DEV_USER_ID. So these assert not
 * only what comes back but that the cookie client is never even constructed,
 * because "returned null" and "returned null without asking anyone else" are
 * different properties and only the second one is safe.
 */

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

import { currentUser, currentUserId } from "@/lib/supabase/server";
import { setVerifier } from "./bearer";

const DEV_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TOKEN_USER = { id: "11111111-1111-4111-8111-111111111111", email: "phone@example.com" };
const COOKIE_USER = { id: "22222222-2222-4222-8222-222222222222", email: "web@example.com" };

const authed = (header: string) =>
  new Request("http://localhost:3000/api/mobile/bootstrap", { headers: { authorization: header } });

const anonymous = () => new Request("http://localhost:3000/api/mobile/bootstrap");

/**
 * `NODE_ENV` is typed read-only, and the production lock on the dev shim is
 * only testable by setting it. Writing through a widened view is the whole of
 * the workaround.
 */
const setNodeEnv = (value: string) => {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DEV_USER_ID;
  setNodeEnv("test");

  mocks.cookies.mockResolvedValue({ getAll: () => [], set: () => {} });
  mocks.createServerClient.mockReturnValue({
    auth: { getUser: async () => ({ data: { user: COOKIE_USER }, error: null }) },
  });
});

afterEach(() => {
  setVerifier(null);
  delete process.env.DEV_USER_ID;
  setNodeEnv("test");
});

describe("currentUser — bearer", () => {
  it("resolves a valid token to the verifier's user, calling it once", async () => {
    const verify = vi.fn(async () => TOKEN_USER);
    setVerifier(verify);

    expect(await currentUser(authed("Bearer good"))).toEqual(TOKEN_USER);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("currentUserId returns the same id", async () => {
    setVerifier(async () => TOKEN_USER);
    expect(await currentUserId(authed("Bearer good"))).toBe(TOKEN_USER.id);
  });

  it("an invalid token is null, and nothing else is consulted", async () => {
    process.env.DEV_USER_ID = DEV_ID;
    setVerifier(async () => null);

    expect(await currentUser(authed("Bearer expired"))).toBeNull();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("a malformed header is null, and nothing else is consulted", async () => {
    process.env.DEV_USER_ID = DEV_ID;
    const verify = vi.fn(async () => TOKEN_USER);
    setVerifier(verify);

    // Present but unparseable: the caller declared itself a token client, so
    // there is nobody to fall back to.
    expect(await currentUser(authed("Bearer a b"))).toBeNull();
    expect(verify).not.toHaveBeenCalled();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("a bearer token beats DEV_USER_ID", async () => {
    process.env.DEV_USER_ID = DEV_ID;
    setVerifier(async () => TOKEN_USER);

    expect(await currentUserId(authed("Bearer good"))).toBe(TOKEN_USER.id);
  });
});

describe("currentUser — DEV_USER_ID shim", () => {
  it("is used when set and no Authorization header is present", async () => {
    process.env.DEV_USER_ID = DEV_ID;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await currentUserId(anonymous())).toBe(DEV_ID);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is dead in production however it is set", async () => {
    process.env.DEV_USER_ID = DEV_ID;
    setNodeEnv("production");
    // Nobody signed in by cookie either, so the only way to get an id here
    // would be the shim leaking into a deployed bundle.
    mocks.createServerClient.mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    expect(await currentUserId(anonymous())).toBeNull();
  });

  it("is inert when the variable is absent", async () => {
    expect(await currentUserId(anonymous())).toBe(COOKIE_USER.id);
  });
});

describe("currentUser — cookies", () => {
  it("falls through to the cookie session with no header and no dev id", async () => {
    expect(await currentUser(anonymous())).toEqual({
      id: COOKIE_USER.id,
      email: COOKIE_USER.email,
    });
    expect(mocks.createServerClient).toHaveBeenCalledTimes(1);
  });

  it("works with no request at all — the server-component path", async () => {
    expect(await currentUserId()).toBe(COOKIE_USER.id);
  });

  it("is null when there is no cookie session", async () => {
    mocks.createServerClient.mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    expect(await currentUser(anonymous())).toBeNull();
  });

  it("tolerates a session with no email", async () => {
    mocks.createServerClient.mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: COOKIE_USER.id } }, error: null }) },
    });
    expect(await currentUser(anonymous())).toEqual({ id: COOKIE_USER.id, email: "" });
  });
});

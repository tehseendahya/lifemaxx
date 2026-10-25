import { describe, it, expect, vi, afterEach } from "vitest";
import { extractBearer, setVerifier, userFromBearer, type BearerUser } from "./bearer";

afterEach(() => setVerifier(null));

describe("extractBearer", () => {
  it("accepts a well-formed header", () => {
    expect(extractBearer("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("accepts the scheme in any case — RFC 7235 says it is case-insensitive", () => {
    expect(extractBearer("bearer x")).toBe("x");
    expect(extractBearer("BEARER x")).toBe("x");
    expect(extractBearer("BeArEr x")).toBe("x");
  });

  it("rejects a missing header", () => {
    expect(extractBearer(null)).toBeNull();
    expect(extractBearer("")).toBeNull();
  });

  it("rejects another scheme", () => {
    expect(extractBearer("Basic abc")).toBeNull();
    expect(extractBearer("Bearerabc")).toBeNull();
  });

  it("rejects a scheme with no token", () => {
    expect(extractBearer("Bearer")).toBeNull();
    expect(extractBearer("Bearer ")).toBeNull();
  });

  it("rejects more than one space", () => {
    expect(extractBearer("Bearer  abc")).toBeNull();
  });

  it("rejects whitespace inside the token — two tokens is not one token", () => {
    expect(extractBearer("Bearer a b")).toBeNull();
    expect(extractBearer("Bearer a\tb")).toBeNull();
  });

  it("rejects surrounding whitespace rather than trimming it", () => {
    expect(extractBearer(" Bearer abc")).toBeNull();
    expect(extractBearer("Bearer abc ")).toBeNull();
    expect(extractBearer("Bearer abc\n")).toBeNull();
  });
});

describe("userFromBearer", () => {
  const user: BearerUser = { id: "11111111-1111-4111-8111-111111111111", email: "a@b.com" };

  it("returns whatever the verifier resolved, and calls it once", async () => {
    const verify = vi.fn(async () => user);
    setVerifier(verify);

    expect(await userFromBearer("tok")).toEqual(user);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith("tok");
  });

  it("returns null when the verifier rejects the token", async () => {
    setVerifier(async () => null);
    expect(await userFromBearer("bad")).toBeNull();
  });

  it("fails closed when verification throws", async () => {
    // A Supabase outage must read as "signed out", never as "signed in as
    // somebody" — and must not become a 500 that looks like our bug.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setVerifier(async () => { throw new Error("getaddrinfo ENOTFOUND"); });

    expect(await userFromBearer("tok")).toBeNull();
    error.mockRestore();
  });

  it("never calls the verifier with an empty token", async () => {
    const verify = vi.fn(async () => user);
    setVerifier(verify);

    expect(await userFromBearer("")).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });
});

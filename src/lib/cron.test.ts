import { describe, it, expect } from "vitest";
import { cronAuthorized } from "./cron";

/**
 * These three endpoints are public URLs that spend money on model calls, so
 * the only thing between them and the open internet is this comparison.
 */
describe("cron authorization", () => {
  const secret = "a-long-random-cron-secret-value";

  it("accepts exactly what Vercel Cron sends", () => {
    expect(cronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(cronAuthorized(null, secret)).toBe(false);
    expect(cronAuthorized("", secret)).toBe(false);
  });

  it("rejects the right secret in the wrong scheme", () => {
    expect(cronAuthorized(secret, secret)).toBe(false);
    expect(cronAuthorized(`Basic ${secret}`, secret)).toBe(false);
  });

  it("rejects a wrong secret of the same length", () => {
    expect(cronAuthorized("Bearer a-long-random-cron-secret-valuX", secret)).toBe(false);
  });

  it("rejects a prefix of the secret", () => {
    expect(cronAuthorized("Bearer a-long-random", secret)).toBe(false);
  });

  it("refuses everything when no secret is configured", () => {
    expect(cronAuthorized("Bearer anything", undefined)).toBe(false);
    expect(cronAuthorized("Bearer ", "")).toBe(false);
  });
});

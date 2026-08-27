import { describe, it, expect } from "vitest";
import { cronAuthorized, weekdayOf } from "./cron";

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

/**
 * The dispatcher shares one Hobby cron slot between the Strava pull and the
 * Sunday review, so this predicate is the only thing deciding whether the
 * weekly review runs at all. Off by one and it never fires, or fires daily.
 */
describe("weekdayOf", () => {
  it("returns 0 for a Sunday", () => {
    expect(weekdayOf("2026-08-30")).toBe(0);
  });

  it("returns the other six days correctly", () => {
    expect(weekdayOf("2026-08-31")).toBe(1); // Mon
    expect(weekdayOf("2026-09-05")).toBe(6); // Sat
  });

  it("does not shift the day when the server is behind UTC", () => {
    // Parsed as UTC, not local: in a US timezone `new Date("2026-08-30")`
    // interpreted locally lands on the 29th and the review never runs.
    expect(weekdayOf("2026-08-30")).toBe(0);
    expect(weekdayOf("2026-01-01")).toBe(4);
  });
});

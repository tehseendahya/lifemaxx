import { describe, it, expect } from "vitest";
import { isUsableTimezone, normaliseTimezone } from "./timezone";

/**
 * The stakes here are higher than they look, which is the reason for the
 * coverage: `profiles.tz` feeds `localDate()`, and `localDate()` is called
 * inside `route()` on the way into every authenticated handler. An unusable
 * zone in that column does not produce a wrong date — it throws, so every
 * request 500s until the row is fixed by hand.
 */

describe("a timezone the server can actually use", () => {
  it("accepts the zones a phone will really report", () => {
    for (const tz of [
      "America/New_York", "America/Los_Angeles", "Europe/London",
      "Asia/Tokyo", "Australia/Sydney", "UTC", "America/Argentina/Buenos_Aires",
    ]) {
      expect(isUsableTimezone(tz), tz).toBe(true);
    }
  });

  it("rejects everything that would make localDate throw", () => {
    for (const tz of [
      "", "   ", "Mars/Olympus_Mons", "GMT+5", "not a zone",
      null, undefined, 42, {}, [],
    ]) {
      expect(isUsableTimezone(tz), String(tz)).toBe(false);
    }
  });

  it("proves the rejected ones really do throw", () => {
    // The assertion above is only meaningful if the bad values are genuinely
    // fatal rather than merely odd — otherwise this check could be deleted as
    // defensive clutter.
    expect(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Mars/Olympus_Mons" })).toThrow();
  });

  it("keeps a usable zone and trims it", () => {
    expect(normaliseTimezone(" Europe/London ")).toBe("Europe/London");
    expect(normaliseTimezone("America/Denver")).toBe("America/Denver");
  });

  it("answers null for anything unusable, rather than guessing UTC", () => {
    // Falling back to UTC would be the same class of bug this fixes — a
    // confident wrong answer about what day it is — just with a different
    // wrong zone. Null means "keep what you had".
    expect(normaliseTimezone("Mars/Olympus_Mons")).toBeNull();
    expect(normaliseTimezone(undefined)).toBeNull();
    expect(normaliseTimezone("")).toBeNull();
  });
});

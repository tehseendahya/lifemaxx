import { describe, it, expect } from "vitest";
import { deviceTimezone, timezoneToReport } from "./timezone";

/**
 * The guard against two failures that are both silent.
 *
 * Reporting nothing leaves the server on its `America/New_York` default, which
 * is the bug: every date in the app computed in the wrong zone. Reporting on
 * every launch is the opposite failure — a write and a round trip each time
 * the app opens, forever, to restate something the server already knows.
 */

describe("what the phone reports", () => {
  it("says nothing when the server already agrees", () => {
    expect(timezoneToReport("America/Los_Angeles", "America/Los_Angeles")).toBeNull();
  });

  it("reports the zone when the server is on the old default", () => {
    // The exact case every existing account is in: nothing has ever written
    // this column, so it holds the schema default.
    expect(timezoneToReport("America/Los_Angeles", "America/New_York"))
      .toBe("America/Los_Angeles");
  });

  it("reports after travel, without needing to know travel happened", () => {
    expect(timezoneToReport("Europe/London", "America/New_York")).toBe("Europe/London");
  });

  it("says nothing when the platform will not name a zone", () => {
    // Better than reporting an empty string and making the server decide what
    // that means.
    expect(timezoneToReport(null, "America/New_York")).toBeNull();
    expect(timezoneToReport(null, undefined)).toBeNull();
  });

  it("reports when the server has not said what it holds", () => {
    // A bootstrap from a server too old to send `tz`. Reporting is the safe
    // direction: the worst case is one redundant write.
    expect(timezoneToReport("Asia/Tokyo", undefined)).toBe("Asia/Tokyo");
  });

  it("is not fooled by whitespace into reporting every launch", () => {
    // If the stored value ever picks up a stray space, an exact comparison
    // would differ forever and POST on every single bootstrap.
    expect(timezoneToReport("Europe/London", " Europe/London ")).toBeNull();
  });
});

describe("reading the phone's zone", () => {
  it("returns a zone this runtime can actually format with", () => {
    const tz = deviceTimezone();
    expect(tz).not.toBe("");
    if (tz !== null) {
      expect(() => new Intl.DateTimeFormat("en-CA", { timeZone: tz })).not.toThrow();
    }
  });
});

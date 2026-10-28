import { describe, it, expect } from "vitest";
import { parseStartedAt, resolveStart } from "./import";

/**
 * Reading the start time off a screenshot.
 *
 * This decides which DAY and therefore which WEEK a run counts for, which is
 * the same class of thing that went wrong when two days of lifting merged into
 * one workout. So the bar is: read it when it is there, and say so plainly
 * when it is not — never shift a date silently.
 *
 * `now` is injected everywhere so "today" and "yesterday" mean something fixed
 * rather than whatever the machine running these happens to think.
 */

/** A Tuesday afternoon, in whatever zone the test runner is in. */
const NOW = new Date(2026, 9, 27, 15, 30);

describe("the forms a running app prints", () => {
  it("reads a full date and time", () => {
    const at = parseStartedAt("October 27, 2026 at 7:02 AM", NOW) as Date;
    expect(at.getFullYear()).toBe(2026);
    expect(at.getMonth()).toBe(9);
    expect(at.getDate()).toBe(27);
    expect(at.getHours()).toBe(7);
    expect(at.getMinutes()).toBe(2);
  });

  it("reads an abbreviated month", () => {
    const at = parseStartedAt("Oct 27, 2026 at 7:02 AM", NOW) as Date;
    expect(at.getMonth()).toBe(9);
    expect(at.getDate()).toBe(27);
  });

  it("reads a day-first date", () => {
    const at = parseStartedAt("27 October 2026 at 07:02", NOW) as Date;
    expect(at.getMonth()).toBe(9);
    expect(at.getDate()).toBe(27);
    expect(at.getHours()).toBe(7);
  });

  it("reads a weekday prefix without tripping on it", () => {
    const at = parseStartedAt("Tuesday, October 27, 2026 at 6:14 PM", NOW) as Date;
    expect(at.getDate()).toBe(27);
    expect(at.getHours()).toBe(18);
  });

  it("reads today and yesterday against the device's own clock", () => {
    const today = parseStartedAt("Today at 7:02 AM", NOW) as Date;
    expect(today.getDate()).toBe(27);
    expect(today.getHours()).toBe(7);

    const yesterday = parseStartedAt("Yesterday at 6:14 PM", NOW) as Date;
    expect(yesterday.getDate()).toBe(26);
    expect(yesterday.getHours()).toBe(18);
  });

  it("rolls yesterday back across a month boundary", () => {
    const firstOfNovember = new Date(2026, 10, 1, 9, 0);
    const at = parseStartedAt("Yesterday at 8:00 AM", firstOfNovember) as Date;
    expect(at.getMonth()).toBe(9);
    expect(at.getDate()).toBe(31);
  });

  it("takes a bare clock as today, which is the only reading ever right for one", () => {
    const at = parseStartedAt("7:02 AM", NOW) as Date;
    expect(at.getDate()).toBe(27);
    expect(at.getHours()).toBe(7);
  });

  it("assumes the current year when the screen omits it", () => {
    const at = parseStartedAt("October 27 at 7:02 AM", NOW) as Date;
    expect(at.getFullYear()).toBe(2026);
  });
});

describe("the clock", () => {
  it("gets both ends of the twelve-hour cycle right", () => {
    // The one case a naive `+12` gets wrong twice.
    expect((parseStartedAt("Today at 12:30 AM", NOW) as Date).getHours()).toBe(0);
    expect((parseStartedAt("Today at 12:30 PM", NOW) as Date).getHours()).toBe(12);
    expect((parseStartedAt("Today at 11:59 PM", NOW) as Date).getHours()).toBe(23);
  });

  it("reads a 24-hour clock", () => {
    expect((parseStartedAt("Today at 19:14", NOW) as Date).getHours()).toBe(19);
    expect((parseStartedAt("Today at 00:05", NOW) as Date).getHours()).toBe(0);
  });

  it("reads a meridiem written with full stops", () => {
    expect((parseStartedAt("Today at 6:14 p.m.", NOW) as Date).getHours()).toBe(18);
  });

  it("defaults to midnight when a date carries no time", () => {
    const at = parseStartedAt("October 27, 2026", NOW) as Date;
    expect(at.getDate()).toBe(27);
    expect(at.getHours()).toBe(0);
  });
});

describe("what it refuses rather than guesses", () => {
  it("returns null for text with no date in it", () => {
    for (const raw of ["", "   ", null, undefined, "Morning Run", "—"]) {
      expect(parseStartedAt(raw, NOW), String(raw)).toBeNull();
    }
  });

  it("refuses a date that does not exist instead of rolling it over", () => {
    // `new Date(2026, 1, 31)` is 3 March. A silently shifted date is worse
    // than admitting the screenshot could not be read — it would put the run
    // in the wrong week with no sign anything went wrong.
    expect(parseStartedAt("February 31, 2026 at 7:02 AM", NOW)).toBeNull();
    expect(parseStartedAt("April 31, 2026", NOW)).toBeNull();
  });

  it("refuses an impossible clock", () => {
    expect(parseStartedAt("Today at 13:30 PM", NOW)).toBeNull();
    expect(parseStartedAt("Today at 7:75 AM", NOW)).toBeNull();
    expect(parseStartedAt("Today at 25:00", NOW)).toBeNull();
  });

  it("does not mistake the clock for the day of the month", () => {
    // The whole reason the time is stripped before the day is read: `7` from
    // `7:02` would otherwise beat `27`.
    const at = parseStartedAt("October 27, 2026 at 7:02 AM", NOW) as Date;
    expect(at.getDate()).toBe(27);
  });

  it("does not mistake the year for the day of the month", () => {
    const at = parseStartedAt("October 2026 27", NOW) as Date;
    expect(at.getDate()).toBe(27);
    expect(at.getFullYear()).toBe(2026);
  });
});

describe("falling back when nothing could be read", () => {
  it("assumes now, and says that it did", () => {
    const { startedAt, assumed } = resolveStart("Morning Run", NOW);
    expect(assumed).toBe(true);
    expect(startedAt).toEqual(NOW);
  });

  it("does not claim to have assumed when it actually read one", () => {
    // The sheet prints a notice off this flag, so a false positive would
    // nag on every correctly-read screenshot.
    const { startedAt, assumed } = resolveStart("Today at 7:02 AM", NOW);
    expect(assumed).toBe(false);
    expect(startedAt.getHours()).toBe(7);
  });
});

// ------------------------------------------------------- the confirmation

import {
  draftBlocked, draftFromShot, draftStats, formatDistance, formatDuration, savePayload,
} from "./import";
import type { ReadShot } from "./requests";
import { M_PER_MILE } from "@/lib/shared/running";

function shot(over: Partial<ReadShot> = {}): ReadShot {
  return {
    readable: true,
    type: "run",
    title: "Morning Run",
    durationS: 25 * 60,
    distanceM: 5000,
    paceSecPerMile: null,
    printedPaceSecPerMile: null,
    warning: null,
    startedAtText: "Today at 7:02 AM",
    elevationM: null,
    avgHr: 158,
    kcal: 320,
    note: "",
    ...over,
  };
}

describe("the figures put in front of the person", () => {
  it("shows distance in miles whatever the screenshot was in", () => {
    // Every other distance in this app is in miles. The stored figure is
    // metres either way, so this is a display choice and nothing is lost.
    expect(formatDistance(5000)).toBe("3.11 mi");
    expect(formatDistance(M_PER_MILE * 3.1)).toBe("3.10 mi");
  });

  it("says nothing rather than zero when there was no distance", () => {
    expect(formatDistance(null)).toBe("—");
  });

  it("formats the clock the way the screenshot did", () => {
    expect(formatDuration(25 * 60)).toBe("25:00");
    expect(formatDuration(48 * 60 + 20)).toBe("48:20");
    expect(formatDuration(3750)).toBe("1:02:30");
    expect(formatDuration(45)).toBe("0:45");
  });

  it("puts distance, time and pace in front of the person", () => {
    const stats = draftStats(draftFromShot(shot(), NOW));
    expect(stats.map((s) => s.label)).toEqual(["Distance", "Time", "Pace"]);
    expect(stats[0].value).toBe("3.11 mi");
    expect(stats[1].value).toBe("25:00");
    // 5km in 25:00 is a shade over 8 minutes a mile.
    expect(stats[2].value).toMatch(/^8:0\d/);
  });

  it("recomputes the pace rather than echoing what the screen said", () => {
    // The printed pace is evidence used to CHECK the reading, not a figure to
    // store — storing it would let a screen in /km quietly become a /mi number.
    const stats = draftStats(draftFromShot(shot({ printedPaceSecPerMile: 999 }), NOW));
    expect(stats[2].value).not.toContain("16:");
  });
});

describe("the draft carried into the sheet", () => {
  it("resolves the start time against this device's clock", () => {
    const draft = draftFromShot(shot(), NOW);
    expect(draft.startedAt.getDate()).toBe(27);
    expect(draft.startedAt.getHours()).toBe(7);
    expect(draft.startAssumed).toBe(false);
  });

  it("flags an assumed date so the sheet can say so", () => {
    const draft = draftFromShot(shot({ startedAtText: null }), NOW);
    expect(draft.startAssumed).toBe(true);
    expect(draft.startedAt).toEqual(NOW);
  });

  it("carries the disagreement warning through untouched", () => {
    const draft = draftFromShot(shot({ warning: "check the units" }), NOW);
    expect(draft.warning).toBe("check the units");
  });

  it("blocks a draft whose figures cannot be a run", () => {
    expect(draftBlocked(draftFromShot(shot(), NOW))).toBeNull();
    expect(draftBlocked(draftFromShot(shot({ durationS: 8 }), NOW))).not.toBeNull();
  });

  it("sends an instant, not a wall-clock string", () => {
    // The server cannot interpret "7:02 AM"; only this device can. By the time
    // it crosses the wire the ambiguity is gone.
    const body = savePayload(draftFromShot(shot(), NOW));
    expect(body.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(new Date(body.startedAt).getHours()).toBe(7);
    expect(body.distanceM).toBe(5000);
    expect(body.avgHr).toBe(158);
  });
});

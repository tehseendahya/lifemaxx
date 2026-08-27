import { describe, it, expect } from "vitest";
import { parseCsv, parseActivityDate, parseActivitiesCsv } from "./strava-export";

describe("parseCsv", () => {
  it("reads a plain table", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps commas inside quoted fields", () => {
    // Activity names are user-written. "Morning Run, then coffee" is ordinary.
    expect(parseCsv('id,name\n1,"Morning Run, then coffee"\n'))
      .toEqual([["id", "name"], ["1", "Morning Run, then coffee"]]);
  });

  it("handles escaped quotes and embedded newlines", () => {
    expect(parseCsv('id,note\n1,"said ""hi""\nthen ran"\n'))
      .toEqual([["id", "note"], ["1", 'said "hi"\nthen ran']]);
  });

  it("handles CRLF and a UTF-8 BOM", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("drops blank lines rather than emitting empty rows", () => {
    expect(parseCsv("a,b\n\n1,2\n\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("parseActivityDate", () => {
  it("reads Strava's display format as UTC", () => {
    expect(parseActivityDate("Aug 27, 2026, 10:00:00 AM")?.toISOString())
      .toBe("2026-08-27T10:00:00.000Z");
  });

  it("gets PM right, and midnight/noon", () => {
    expect(parseActivityDate("Aug 27, 2026, 1:30:00 PM")?.toISOString())
      .toBe("2026-08-27T13:30:00.000Z");
    expect(parseActivityDate("Aug 27, 2026, 12:00:00 AM")?.toISOString())
      .toBe("2026-08-27T00:00:00.000Z");
    expect(parseActivityDate("Aug 27, 2026, 12:00:00 PM")?.toISOString())
      .toBe("2026-08-27T12:00:00.000Z");
  });

  it("does not drift with the machine's timezone", () => {
    // The whole point of building this from Date.UTC: `new Date("Aug 27, 2026")`
    // is parsed locally, so this same run would file on the 26th in Sydney.
    expect(parseActivityDate("Aug 27, 2026, 2:00:00 AM")?.toISOString())
      .toBe("2026-08-27T02:00:00.000Z");
  });

  it("accepts ISO and day-first forms", () => {
    expect(parseActivityDate("2026-08-27T10:00:00Z")?.toISOString())
      .toBe("2026-08-27T10:00:00.000Z");
    expect(parseActivityDate("27 Aug 2026, 10:00:00")?.toISOString())
      .toBe("2026-08-27T10:00:00.000Z");
  });

  it("returns null rather than an Invalid Date", () => {
    expect(parseActivityDate("")).toBeNull();
    expect(parseActivityDate("not a date")).toBeNull();
  });
});

describe("parseActivitiesCsv", () => {
  /** The real export repeats "Elapsed Time" and "Distance". */
  const csv = [
    "Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Distance,Moving Time,Distance,Elevation Gain,Calories,Average Heart Rate,Relative Effort",
    '1001,"Aug 27, 2026, 10:00:00 AM","Morning Run, easy",Run,1900,8.05,1800,8046.7,42.5,610,152,31',
    '1002,"Aug 28, 2026, 6:00:00 PM","Evening Ride",Ride,3700,25.1,3600,25100,180,900,141,55',
  ].join("\n");

  it("picks metres, not the display column", () => {
    const { activities, distanceInferred } = parseActivitiesCsv(csv);
    expect(distanceInferred).toBe(false);
    expect(activities[0].distanceM).toBe(8046.7);
    expect(activities[1].distanceM).toBe(25100);
  });

  it("prefers moving time over elapsed", () => {
    // Elapsed includes standing at traffic lights; the API sync makes the same
    // choice, so an imported run and a synced one report the same pace.
    expect(parseActivitiesCsv(csv).activities[0].durationS).toBe(1800);
  });

  it("maps the remaining fields", () => {
    const a = parseActivitiesCsv(csv).activities[0];
    expect(a).toMatchObject({
      externalId: "1001",
      name: "Morning Run, easy",
      type: "Run",
      elevationM: 42.5,
      kcal: 610,
      avgHr: 152,
      sufferScore: 31,
    });
    expect(a.startedAt.toISOString()).toBe("2026-08-27T10:00:00.000Z");
  });

  it("converts when only a display distance column exists", () => {
    const single = [
      "Activity ID,Activity Date,Activity Name,Activity Type,Moving Time,Distance",
      '1001,"Aug 27, 2026, 10:00:00 AM",Run,Run,1800,8.05',
    ].join("\n");
    const { activities, distanceInferred } = parseActivitiesCsv(single);
    expect(distanceInferred).toBe(true);
    expect(activities[0].distanceM).toBeCloseTo(8050, 0);
  });

  it("skips unusable rows instead of failing the whole import", () => {
    const messy = [
      "Activity ID,Activity Date,Activity Name,Activity Type,Moving Time,Distance",
      ',"Aug 27, 2026, 10:00:00 AM",No id,Run,1800,8046',
      '1002,"garbage",Bad date,Run,1800,8046',
      '1003,"Aug 27, 2026, 10:00:00 AM",No duration,Run,0,8046',
      '1004,"Aug 27, 2026, 10:00:00 AM",Fine,Run,1800,8046',
    ].join("\n");
    const { activities, skipped } = parseActivitiesCsv(messy);
    expect(activities.map((a) => a.externalId)).toEqual(["1004"]);
    expect(skipped.map((s) => s.reason)).toEqual([
      "no Activity ID",
      'unreadable date "garbage"',
      "no duration",
    ]);
  });

  it("survives an empty file", () => {
    expect(parseActivitiesCsv("").activities).toEqual([]);
  });
});

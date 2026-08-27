import { describe, it, expect } from "vitest";
import { parseHealthPayload, parseHealthDate, toMetres, toKg } from "./health-export";

describe("toMetres", () => {
  it("converts the units Health Auto Export actually sends", () => {
    expect(toMetres({ qty: 1, units: "mi" })).toBeCloseTo(1609.344, 3);
    expect(toMetres({ qty: 5, units: "km" })).toBe(5000);
    expect(toMetres({ qty: 400, units: "m" })).toBe(400);
    expect(toMetres({ qty: 100, units: "ft" })).toBeCloseTo(30.48, 2);
  });

  it("drops a value whose unit it cannot read, rather than guessing", () => {
    // Miles read as kilometres is a 60% error on every distance in the app.
    expect(toMetres({ qty: 5, units: "furlongs" })).toBeNull();
    expect(toMetres({ qty: 5 })).toBeNull();
    expect(toMetres(undefined)).toBeNull();
  });
});

describe("toKg", () => {
  it("converts weight units", () => {
    expect(toKg({ qty: 80, units: "kg" })).toBe(80);
    expect(toKg({ qty: 176.37, units: "lb" })).toBeCloseTo(80, 1);
  });
  it("returns null on an unknown unit", () => {
    expect(toKg({ qty: 80, units: "?" })).toBeNull();
  });
});

describe("parseHealthDate", () => {
  it("reads the app's own format, honouring the offset", () => {
    // "yyyy-MM-dd HH:mm:ss Z" — a space, and no colon in the offset. Not ISO.
    expect(parseHealthDate("2024-02-06 07:00:00 -0800")?.toISOString())
      .toBe("2024-02-06T15:00:00.000Z");
    expect(parseHealthDate("2026-08-27 06:30:00 +1000")?.toISOString())
      .toBe("2026-08-26T20:30:00.000Z");
  });

  it("accepts ISO and colon-separated offsets too", () => {
    expect(parseHealthDate("2024-02-06T07:00:00Z")?.toISOString())
      .toBe("2024-02-06T07:00:00.000Z");
    expect(parseHealthDate("2024-02-06 07:00:00 -08:00")?.toISOString())
      .toBe("2024-02-06T15:00:00.000Z");
  });

  it("returns null instead of an Invalid Date", () => {
    expect(parseHealthDate("nonsense")).toBeNull();
    expect(parseHealthDate(undefined)).toBeNull();
    expect(parseHealthDate(42)).toBeNull();
  });
});

describe("parseHealthPayload", () => {
  const payload = {
    data: {
      workouts: [
        {
          id: "HK-1", name: "Running",
          start: "2026-08-27 06:30:00 +1000", end: "2026-08-27 07:00:00 +1000",
          duration: 1800,
          distance: { qty: 5, units: "mi" },
          activeEnergyBurned: { qty: 612.4, units: "kcal" },
          elevationUp: { qty: 100, units: "ft" },
          avgHeartRate: { qty: 152, units: "bpm" },
        },
      ],
      metrics: [
        { name: "weight_body_mass", units: "lb",
          data: [{ date: "2026-08-27 07:00:00 +1000", qty: 176.37 }] },
        { name: "step_count", units: "count",
          data: [{ date: "2026-08-27 07:00:00 +1000", qty: 8123.6 }] },
        { name: "some_metric_we_do_not_store", units: "x",
          data: [{ date: "2026-08-27 07:00:00 +1000", qty: 1 }] },
      ],
    },
  };

  it("converts a workout into metric storage units", () => {
    const { workouts } = parseHealthPayload(payload);
    expect(workouts).toHaveLength(1);
    expect(workouts[0].distanceM).toBeCloseTo(8046.72, 1);   // 5 mi, not 5 m
    expect(workouts[0].elevationM).toBeCloseTo(30.48, 1);    // 100 ft
    expect(workouts[0].kcal).toBe(612);
    expect(workouts[0].avgHr).toBe(152);
    expect(workouts[0].externalId).toBe("HK-1");
    expect(workouts[0].startedAt.toISOString()).toBe("2026-08-26T20:30:00.000Z");
  });

  it("falls back to end - start when duration is absent", () => {
    const noDuration = {
      data: { workouts: [{
        id: "HK-2", name: "Running",
        start: "2026-08-27 06:30:00 +1000", end: "2026-08-27 07:15:00 +1000",
      }] },
    };
    expect(parseHealthPayload(noDuration).workouts[0].durationS).toBe(2700);
  });

  it("keeps only the metrics that map to a column, converted", () => {
    const { metricPoints } = parseHealthPayload(payload);
    expect(metricPoints.map((p) => p.field).sort()).toEqual(["steps", "weightKg"]);
    expect(metricPoints.find((p) => p.field === "weightKg")!.value).toBeCloseTo(80, 1);
    expect(metricPoints.find((p) => p.field === "steps")!.value).toBe(8124);
  });

  it("returns the instant, leaving the day to the caller's timezone", () => {
    // 07:00 on the 27th at +1000 is 21:00 on the 26th in UTC. Bucketing here
    // would file every Sydney morning weigh-in on the day before.
    const [point] = parseHealthPayload(payload).metricPoints;
    expect(point.at.toISOString()).toBe("2026-08-26T21:00:00.000Z");
    expect(point).not.toHaveProperty("date");
  });

  it("skips unusable workouts instead of rejecting the payload", () => {
    // Batch Requests means partial payloads are normal; one bad workout must
    // not cost the rest of the batch.
    const messy = {
      data: { workouts: [
        { name: "No id", start: "2026-08-27 06:30:00 +1000", duration: 100 },
        { id: "HK-3", name: "Bad date", start: "nope", duration: 100 },
        { id: "HK-4", name: "No duration", start: "2026-08-27 06:30:00 +1000" },
        { id: "HK-5", name: "Fine", start: "2026-08-27 06:30:00 +1000", duration: 100 },
      ] },
    };
    const { workouts, skipped } = parseHealthPayload(messy);
    expect(workouts.map((w) => w.externalId)).toEqual(["HK-5"]);
    expect(skipped).toHaveLength(3);
  });

  it("survives a payload with nothing it recognises", () => {
    expect(parseHealthPayload({}).workouts).toEqual([]);
    expect(parseHealthPayload(null).workouts).toEqual([]);
    expect(parseHealthPayload({ data: { workouts: "not an array" } }).workouts).toEqual([]);
  });
});

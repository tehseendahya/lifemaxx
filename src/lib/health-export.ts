/**
 * Parses a Health Auto Export payload.
 *
 * That $5 iOS app reads HealthKit — which the web platform cannot — and POSTs
 * it here on a schedule. It is the bridge the spec picked for Apple Health, and
 * since Strava put API access behind a subscription in June 2026 it is also the
 * way runs arrive without paying for one: Strava's own iOS app writes workouts
 * into Apple Health, as does an Apple Watch.
 *
 * Pure: no database, no network. The parts worth testing are the unit handling
 * and the date format, and neither needs either.
 */

export interface ParsedWorkout {
  externalId: string;
  name: string;
  type: string;
  startedAt: Date;
  durationS: number;
  distanceM: number | null;
  elevationM: number | null;
  avgHr: number | null;
  kcal: number | null;
}

/**
 * One measurement at one instant.
 *
 * Deliberately not grouped into days here. Which day a 7:30am weigh-in belongs
 * to depends on the athlete's timezone, and this module does not know it —
 * bucketing by UTC would file every morning reading in Sydney on the previous
 * day and quietly drag the TDEE trend a day out of step with the meals it is
 * compared against. The caller groups, using the same localDate() the workout
 * rows go through.
 */
export interface ParsedMetricPoint {
  at: Date;
  field: "weightKg" | "bodyFatPct" | "steps" | "restingHr";
  value: number;
}

export interface HealthReport {
  workouts: ParsedWorkout[];
  metricPoints: ParsedMetricPoint[];
  skipped: { what: string; reason: string }[];
}

interface Qty { qty?: unknown; units?: unknown }

const asNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v)
    : null;

/**
 * Converts a {qty, units} pair to metres.
 *
 * The units are whatever the athlete set in the Health app, so they are read
 * rather than assumed — a payload in miles treated as kilometres is a 60%
 * error in every distance, and one treated as metres is a 1600x error. When
 * the unit is missing or unrecognised the value is dropped instead of guessed.
 */
export function toMetres(q: Qty | undefined): number | null {
  const n = asNumber(q?.qty);
  if (n === null) return null;
  switch (String(q?.units ?? "").trim().toLowerCase()) {
    case "mi": case "mile": case "miles": return n * 1609.344;
    case "km": case "kilometer": case "kilometers": return n * 1000;
    case "m": case "meter": case "meters": return n;
    case "ft": case "feet": return n * 0.3048;
    case "yd": case "yards": return n * 0.9144;
    default: return null;
  }
}

export function toKg(q: Qty | undefined): number | null {
  const n = asNumber(q?.qty);
  if (n === null) return null;
  switch (String(q?.units ?? "").trim().toLowerCase()) {
    case "kg": case "kilogram": case "kilograms": return n;
    case "lb": case "lbs": case "pound": case "pounds": return n * 0.45359237;
    case "st": case "stone": return n * 6.35029318;
    default: return null;
  }
}

/**
 * Health Auto Export writes `yyyy-MM-dd HH:mm:ss Z`, e.g.
 * "2024-02-06 07:00:00 -0800".
 *
 * That is not ISO 8601 — the space instead of a T, and the offset without a
 * colon — so `new Date()` rejects it in some runtimes and silently reads it as
 * local time in others. Normalised explicitly, because the offset is the only
 * thing that puts a 7am run on the right calendar day.
 */
export function parseHealthDate(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.trim();

  const m = s.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (!m) return null;

  let offset = m[3] ?? "Z";
  if (offset !== "Z" && !offset.includes(":")) {
    offset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
  }
  const time = m[2].length === 5 ? `${m[2]}:00` : m[2];
  const d = new Date(`${m[1]}T${time}${offset}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Which HealthKit metric names map onto columns we actually store. */
const METRICS: Record<string, ParsedMetricPoint["field"]> = {
  weight_body_mass: "weightKg",
  body_fat_percentage: "bodyFatPct",
  step_count: "steps",
  resting_heart_rate: "restingHr",
};

export function parseHealthPayload(body: unknown): HealthReport {
  const skipped: { what: string; reason: string }[] = [];
  const workouts: ParsedWorkout[] = [];

  const data = (body as { data?: unknown })?.data as
    | { workouts?: unknown; metrics?: unknown }
    | undefined;

  for (const raw of Array.isArray(data?.workouts) ? data.workouts : []) {
    const w = raw as Record<string, unknown>;
    const startedAt = parseHealthDate(w.start);
    const label = String(w.name ?? "workout");

    if (!startedAt) { skipped.push({ what: label, reason: "unreadable start date" }); continue; }

    // HealthKit ids are stable per workout, which is what makes a resend — and
    // Batch Requests resends constantly — land on the same row.
    const externalId = typeof w.id === "string" && w.id.trim() ? w.id.trim() : null;
    if (!externalId) { skipped.push({ what: label, reason: "no id" }); continue; }

    const end = parseHealthDate(w.end);
    const duration = asNumber(w.duration)
      ?? (end ? Math.round((end.getTime() - startedAt.getTime()) / 1000) : null);
    if (!duration || duration <= 0) { skipped.push({ what: label, reason: "no duration" }); continue; }

    const energy = (w.activeEnergyBurned ?? w.totalEnergy) as Qty | undefined;
    const kcal = asNumber(energy?.qty);

    workouts.push({
      externalId,
      name: label,
      type: label,
      startedAt,
      durationS: Math.round(duration),
      distanceM: toMetres(w.distance as Qty | undefined),
      elevationM: toMetres(w.elevationUp as Qty | undefined),
      avgHr: asNumber((w.avgHeartRate as Qty | undefined)?.qty),
      kcal: kcal === null ? null : Math.round(kcal),
    });
  }

  // Metrics arrive as one object per measurement, each with its own series.
  const metricPoints: ParsedMetricPoint[] = [];
  for (const raw of Array.isArray(data?.metrics) ? data.metrics : []) {
    const m = raw as { name?: unknown; units?: unknown; data?: unknown };
    const field = METRICS[String(m.name ?? "")];
    if (!field) continue;

    for (const point of Array.isArray(m.data) ? m.data : []) {
      const p = point as Record<string, unknown>;
      const at = parseHealthDate(p.date);
      if (!at) continue;

      const raw = asNumber(p.qty) ?? asNumber(p.avg);
      if (raw === null) continue;

      let value = raw;
      if (field === "weightKg") {
        const kg = toKg({ qty: raw, units: m.units });
        if (kg === null) { skipped.push({ what: "weight", reason: `unknown unit ${String(m.units)}` }); continue; }
        value = kg;
      } else if (field === "steps") {
        value = Math.round(raw);
      }
      metricPoints.push({ at, field, value });
    }
  }

  return { workouts, metricPoints, skipped };
}

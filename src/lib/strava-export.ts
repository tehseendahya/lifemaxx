/**
 * Reads the `activities.csv` from a Strava account archive.
 *
 * Strava put Standard-tier API access behind a subscription in June 2026, but
 * the account export is free and is the same data. It carries Strava's own
 * activity id, so rows imported here and rows pulled later over the API land on
 * the same unique index — (user_id, provider, external_id) — and converge
 * rather than duplicating. That is why these are stored as provider "strava"
 * and not as "manual".
 *
 * Pure on purpose: no filesystem, no database. The fiddly parts are the CSV
 * quoting and the column layout, and both are testable without either.
 */

/** One activity, in the shape the `activities` table wants. */
export interface ParsedActivity {
  externalId: string;
  name: string;
  type: string;
  startedAt: Date;
  durationS: number;
  distanceM: number | null;
  elevationM: number | null;
  avgHr: number | null;
  kcal: number | null;
  sufferScore: number | null;
}

export interface ParseReport {
  activities: ParsedActivity[];
  /** Rows that could not be read, with the reason, for reporting. */
  skipped: { line: number; reason: string }[];
  /** Which column the distance came from, so a run can be sanity-checked. */
  distanceColumn: string | null;
  /** True when metres had to be inferred rather than read directly. */
  distanceInferred: boolean;
}

/**
 * RFC 4180 CSV, because Strava's export needs it.
 *
 * Activity names are user-written and routinely contain commas, quotes and
 * newlines ("Morning Run, then coffee"), and the description column can hold
 * whole paragraphs. Splitting on commas mangles roughly every third export.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  // Strip a UTF-8 BOM; Excel adds one and it corrupts the first header name.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  for (; i < text.length; i += 1) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }  // escaped quote
        else quoted = false;
      } else field += c;
      continue;
    }

    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }

  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

const num = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Strava writes activity dates in UTC, in a human format like
 * "Aug 27, 2026, 10:00:00 AM".
 *
 * Parsed as UTC explicitly rather than handed to `new Date(string)`, which
 * would read it in the machine's own zone — importing the same archive on a
 * laptop in Sydney and a server in Virginia would then file the same run on
 * two different days.
 */
export function parseActivityDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  // ISO, which some locales and the API both produce.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(s) ? s : `${s}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const m = s.match(
    /^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i,
  );
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month === undefined) return null;
    let hour = Number(m[4]);
    const period = m[7]?.toUpperCase();
    if (period === "PM" && hour !== 12) hour += 12;
    if (period === "AM" && hour === 12) hour = 0;
    return new Date(Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5]), Number(m[6] ?? 0)));
  }

  // "27 Aug 2026, 10:00:00"
  const e = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (e) {
    const month = MONTHS[e[2].toLowerCase()];
    if (month === undefined) return null;
    return new Date(Date.UTC(Number(e[3]), month, Number(e[1]), Number(e[4]), Number(e[5]), Number(e[6] ?? 0)));
  }

  return null;
}

/** Every index whose header matches, since the export repeats several names. */
const indicesOf = (headers: string[], name: string): number[] =>
  headers.flatMap((h, i) => (h.trim().toLowerCase() === name.toLowerCase() ? [i] : []));

const firstIndex = (headers: string[], ...names: string[]): number => {
  for (const n of names) {
    const [i] = indicesOf(headers, n);
    if (i !== undefined) return i;
  }
  return -1;
};

/**
 * Picks the Distance column that holds metres.
 *
 * The export contains "Distance" twice: once formatted for display in the
 * athlete's own units (km or miles, so "8.05") and once raw in metres
 * ("8046.7"). They are not distinguishable by name, and guessing wrong is a
 * 1000x error that would silently rewrite every weekly mileage number. The
 * larger column is metres — that comparison holds for km and miles alike.
 */
function pickDistanceColumn(headers: string[], rows: string[][]): { index: number; inferred: boolean } {
  const candidates = indicesOf(headers, "Distance");
  if (candidates.length === 0) return { index: -1, inferred: false };

  if (candidates.length === 1) {
    const max = Math.max(0, ...rows.map((r) => num(r[candidates[0]]) ?? 0));
    // A single column under a kilometre across an entire archive is not metres.
    return { index: candidates[0], inferred: max > 0 && max < 1000 };
  }

  let best = candidates[0];
  let bestMax = -1;
  for (const c of candidates) {
    const max = Math.max(0, ...rows.map((r) => num(r[c]) ?? 0));
    if (max > bestMax) { bestMax = max; best = c; }
  }
  return { index: best, inferred: false };
}

export function parseActivitiesCsv(text: string): ParseReport {
  const table = parseCsv(text);
  if (table.length === 0) {
    return { activities: [], skipped: [], distanceColumn: null, distanceInferred: false };
  }

  const headers = table[0];
  const body = table.slice(1);

  const idIdx = firstIndex(headers, "Activity ID");
  const dateIdx = firstIndex(headers, "Activity Date");
  const nameIdx = firstIndex(headers, "Activity Name");
  const typeIdx = firstIndex(headers, "Activity Type");
  const elevIdx = firstIndex(headers, "Elevation Gain");
  const kcalIdx = firstIndex(headers, "Calories");
  const hrIdx = firstIndex(headers, "Average Heart Rate");
  const effortIdx = firstIndex(headers, "Relative Effort");

  // Moving time is the honest duration for a run; elapsed includes standing at
  // traffic lights. Elapsed is the fallback, matching the API sync's choice.
  const movingIdx = firstIndex(headers, "Moving Time");
  const elapsedCandidates = indicesOf(headers, "Elapsed Time");

  const { index: distIdx, inferred } = pickDistanceColumn(headers, body);

  const activities: ParsedActivity[] = [];
  const skipped: { line: number; reason: string }[] = [];

  body.forEach((r, n) => {
    const line = n + 2; // 1-based, plus the header row
    const externalId = (r[idIdx] ?? "").trim();
    if (!externalId) { skipped.push({ line, reason: "no Activity ID" }); return; }

    const startedAt = parseActivityDate(r[dateIdx] ?? "");
    if (!startedAt) {
      skipped.push({ line, reason: `unreadable date ${JSON.stringify(r[dateIdx] ?? "")}` });
      return;
    }

    const moving = num(r[movingIdx]);
    const elapsed = elapsedCandidates.map((i) => num(r[i])).find((v) => v !== null && v > 0) ?? null;
    const durationS = Math.round(moving && moving > 0 ? moving : elapsed ?? 0);
    if (durationS <= 0) { skipped.push({ line, reason: "no duration" }); return; }

    const rawDist = distIdx >= 0 ? num(r[distIdx]) : null;
    const distanceM = rawDist === null ? null : inferred ? rawDist * 1000 : rawDist;

    activities.push({
      externalId,
      name: (r[nameIdx] ?? "").trim(),
      type: (r[typeIdx] ?? "").trim() || "Workout",
      startedAt,
      durationS,
      distanceM,
      elevationM: elevIdx >= 0 ? num(r[elevIdx]) : null,
      avgHr: hrIdx >= 0 ? num(r[hrIdx]) : null,
      kcal: kcalIdx >= 0 ? (num(r[kcalIdx]) !== null ? Math.round(num(r[kcalIdx])!) : null) : null,
      sufferScore: effortIdx >= 0 ? num(r[effortIdx]) : null,
    });
  });

  return {
    activities,
    skipped,
    distanceColumn: distIdx >= 0 ? `column ${distIdx}` : null,
    distanceInferred: inferred,
  };
}

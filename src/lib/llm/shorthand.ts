/**
 * Deterministic parser for lifting shorthand.
 *
 * This started as a test fixture and earned a promotion. It handles the notation
 * people actually type, costs nothing, and works with the phone in airplane
 * mode — so it runs FIRST on every text entry, and the model is only called when
 * this returns nothing. Most gym entries never touch the network.
 */

export interface ParsedSet {
  reps: number;
  weight_lb: number;
  rpe: number | null;
  to_failure: boolean;
  is_warmup: boolean;
}

export interface ParsedEntry {
  exercise_query: string;
  sets: ParsedSet[];
}

const KG_TO_LB = 2.2046226218;

/** "@rpe8", "@8", "rpe 8.5" */
function extractRpe(text: string): { rpe: number | null; rest: string } {
  const m = text.match(/@\s*(?:rpe\s*)?(\d+(?:\.\d)?)|(?:^|\s)rpe\s*(\d+(?:\.\d)?)/i);
  if (!m) return { rpe: null, rest: text };
  const value = Number(m[1] ?? m[2]);
  if (!Number.isFinite(value) || value < 1 || value > 10) return { rpe: null, rest: text };
  return { rpe: value, rest: text.replace(m[0], " ") };
}

function extractFlags(text: string) {
  const toFailure = /\b(to\s+failure|till\s+failure|amrap|failure)\b/i.test(text);
  const isWarmup = /\b(warm\s?-?ups?|wu)\b/i.test(text);
  return {
    toFailure,
    isWarmup,
    rest: text
      .replace(/\b(to\s+failure|till\s+failure|amrap|failure)\b/gi, " ")
      .replace(/\b(warm\s?-?ups?|wu)\b/gi, " "),
  };
}

/** "bw+25" / "bw" — bodyweight work, optionally loaded. */
function parseBodyweight(token: string): number | null {
  const m = token.match(/^bw\s*(?:\+\s*(\d+(?:\.\d+)?))?$/i);
  if (!m) return null;
  return m[1] ? Number(m[1]) : 0;
}

function toLb(value: number, isKg: boolean): number {
  return isKg ? Math.round(value * KG_TO_LB * 10) / 10 : value;
}

/**
 * Parse one exercise's worth of shorthand. Returns null when nothing
 * set-shaped is found, which is the signal to fall through to the model.
 */
export function parseEntry(input: string): ParsedEntry | null {
  const raw = input.trim();
  if (!raw) return null;

  // A unit suffix sits flush against the number ("100kg"), where there is no
  // word boundary between the digit and the letter — so match on the digit.
  const isKg = /\d\s*kgs?\b/i.test(raw) || /\bkgs?\b/i.test(raw);
  const flags = extractFlags(raw);
  let text = flags.rest
    .replace(/(\d)\s*(?:kgs?|lbs?|pounds?)\b/gi, "$1 ")
    .replace(/\b(?:kgs?|lbs?|pounds?)\b/gi, " ");

  // The exercise name is everything before the first numeric/bw token.
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  const firstNumeric = tokens.findIndex((t) => /^\d|^bw/i.test(t));
  if (firstNumeric <= 0) return null;

  const exercise = tokens.slice(0, firstNumeric).join(" ").trim();
  if (!exercise) return null;

  const body = text.slice(text.indexOf(tokens[firstNumeric]));
  const sets: ParsedSet[] = [];

  // Split on commas and "then" — each chunk is one or more identical sets.
  for (const chunkRaw of body.split(/\s*(?:,|\bthen\b|\band\b)\s*/i)) {
    const chunk = chunkRaw.trim();
    if (!chunk) continue;

    const { rpe, rest } = extractRpe(chunk);
    const c = rest.trim();

    // "5x5 185" — sets x reps, then weight.
    let m = c.match(/^(\d+)\s*[x×]\s*(\d+)\s+(bw\s*(?:\+\s*\d+(?:\.\d+)?)?|\d+(?:\.\d+)?)$/i);
    if (m) {
      const count = Number(m[1]);
      const reps = Number(m[2]);
      const bw = parseBodyweight(m[3]);
      const weight = bw ?? Number(m[3]);
      for (let i = 0; i < count; i++) {
        sets.push({ reps, weight_lb: toLb(weight, isKg), rpe, to_failure: flags.toFailure, is_warmup: flags.isWarmup });
      }
      continue;
    }

    // "185x5" — weight x reps, a single set.
    m = c.match(/^(bw\s*(?:\+\s*\d+(?:\.\d+)?)?|\d+(?:\.\d+)?)\s*[x×]\s*(\d+)$/i);
    if (m) {
      const bw = parseBodyweight(m[1]);
      const weight = bw ?? Number(m[1]);
      sets.push({ reps: Number(m[2]), weight_lb: toLb(weight, isKg), rpe, to_failure: flags.toFailure, is_warmup: flags.isWarmup });
      continue;
    }

    // "185 for 8" / "bw+25 for 8"
    m = c.match(/^(bw\s*(?:\+\s*\d+(?:\.\d+)?)?|\d+(?:\.\d+)?)\s+for\s+(\d+)$/i);
    if (m) {
      const bw = parseBodyweight(m[1]);
      const weight = bw ?? Number(m[1]);
      sets.push({ reps: Number(m[2]), weight_lb: toLb(weight, isKg), rpe, to_failure: flags.toFailure, is_warmup: flags.isWarmup });
      continue;
    }

    // A bare rep count continues the previous set's weight: "8,8,6"
    m = c.match(/^(\d+)$/);
    if (m && sets.length > 0) {
      sets.push({ ...sets[sets.length - 1], reps: Number(m[1]), rpe });
      continue;
    }

    return null; // Something we don't understand — let the model try.
  }

  return sets.length > 0 ? { exercise_query: exercise, sets } : null;
}

/** Handles "bench 5x5 185; squat 225x5" and newline-separated entries. */
export function parseShorthand(input: string): ParsedEntry[] {
  const lines = input.split(/[\n;]+/).map((l) => l.trim()).filter(Boolean);
  const entries: ParsedEntry[] = [];
  for (const line of lines) {
    const entry = parseEntry(line);
    if (!entry) return [];
    entries.push(entry);
  }
  return entries;
}

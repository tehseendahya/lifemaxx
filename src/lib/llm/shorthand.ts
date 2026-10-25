/**
 * Deterministic parser for lifting shorthand.
 *
 * This started as a test fixture and earned a promotion. It handles the notation
 * people actually type, costs nothing, and works with the phone in airplane
 * mode — so it runs FIRST on every text entry, and the model is only called when
 * this returns nothing. Most gym entries never touch the network.
 *
 * Three rules govern every change in here, in this order:
 *
 *  1. A silently wrong number is the worst outcome available. A set logged as
 *     165 reps corrupts the trend chart and nothing on screen looks odd. A
 *     model call costs a round trip; a parse failure is visible in the
 *     confirmation sheet. Both are preferable.
 *  2. Structure that is recognised but numerically implausible is AMBIGUOUS and
 *     the chunk is dropped (see `SANITY`). Structure that is not recognised at
 *     all fails the whole line, which hands it to the model intact.
 *  3. Every form added here is one the owner can log offline, instantly, with
 *     no chance of a hallucinated number. That is the whole point of the file.
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
  /**
   * Chunks that were set-shaped but failed `SANITY` and were therefore NOT
   * logged — "165" out of "165,5". Optional and additive: the model path does
   * not produce it. Surfacing it in the confirmation sheet is how a dropped
   * chunk stays visible rather than silent.
   */
  dropped?: string[];
}

const KG_TO_LB = 2.2046226218;

/**
 * Bounds that separate "a set" from "a typo".
 *
 * `maxReps: 100` — the owner typed "165,5" meaning "165x5" and got a set of
 * 165 reps at 165 lb. Three-digit rep counts are overwhelmingly a weight that
 * lost its `x`. Genuine three-digit sets exist only in bodyweight work
 * (pushups, situps, air squats) and 100 is where people round off; above it we
 * would rather pay for a model call than record a number we do not believe.
 * Because an over-ceiling chunk is DROPPED rather than failing the line, a real
 * 120-rep set written on its own still reaches the model and still gets logged.
 *
 * `maxWeightLb: 2000` — the heaviest loaded machine work in a commercial gym
 * (leg press, hack squat) tops out around 1,000–1,400 lb, so 2000 clears any
 * human effort while still catching a digit slip like "16500x5".
 *
 * `maxSetCount: 30` — 30 working sets of one exercise in one session is already
 * past any program; beyond that "165 sets" would mint 165 identical rows.
 */
export const SANITY = {
  minReps: 1,
  maxReps: 100,
  maxWeightLb: 2000,
  maxSetCount: 30,
} as const;

/**
 * Is this a set, or a typo?
 *
 * Exported because for a long time it was not, and the bound therefore only
 * existed on the deterministic path. The model path validated against
 * `parsedSetsSchema`, which says `int().positive()` and `nonnegative()` and
 * nothing more, and `POST /api/sets` did not check at all — so "165,5" on a
 * line of its own went unparsed, straight to the model, and could come back as
 * a 165-rep set. The reported bug was narrowed, not closed.
 *
 * The bound cannot be moved into `parsedSetsSchema`: that schema is handed to
 * OpenAI as a strict structured-output JSON Schema, which does not support
 * `minimum`/`maximum`, so adding them there breaks the request rather than the
 * typo. It has to be applied to the model's answer after it arrives, and again
 * at the write path, which is the only place every client passes through.
 */
export function setWithinSanity(reps: number, weightLb: number): boolean {
  if (!Number.isInteger(reps) || reps < SANITY.minReps || reps > SANITY.maxReps) return false;
  if (!Number.isFinite(weightLb) || weightLb < 0 || weightLb > SANITY.maxWeightLb) return false;
  return true;
}

/**
 * Leading filler, as a small CLOSED list.
 *
 * "today did bench 165x5" must yield "bench", not "today did bench". This is
 * deliberately NOT an open-ended stop-word heuristic: an open list eventually
 * eats a real exercise name ("Press", "Row", "Good morning"), and a set filed
 * against the wrong exercise is rule 1. Longest first so "i did" wins over
 * "did".
 */
const LEADING_FILLER = [
  "finished with",
  "i did",
  "today",
  "also",
  "then",
  "next",
  "and",
  "did",
] as const;

/** Weight: a number, or bodyweight with optional added load. */
const WEIGHT = String.raw`(bw\s*(?:\+\s*\d+(?:\.\d+)?)?|\d+(?:\.\d+)?)`;
const UNIT = String.raw`kgs?|lbs?|pounds?`;
/**
 * What may follow a unit suffix. `\b` is useless here: in "30kgx8" there is no
 * boundary between the "g" and the "x", which is exactly why "3 sets 30kgx8"
 * used to parse as nothing at all.
 */
const UNIT_TAIL = String.raw`(?=[x×]\s*\d|\s|,|$)`;

const RE_IS_KG = new RegExp(String.raw`\d\s*kgs?${UNIT_TAIL}|\bkgs?\b`, "i");
const RE_UNIT_AFTER_NUMBER = new RegExp(String.raw`(\d)\s*(?:${UNIT})${UNIT_TAIL}`, "gi");
const RE_UNIT_BARE = new RegExp(String.raw`\b(?:${UNIT})\b`, "gi");

const chunkRe = (body: string) => new RegExp(`^${body}$`, "i");

/** "5x5 185" — leading count is SETS, then reps, then weight. */
const RE_SETS_X_REPS_WEIGHT = chunkRe(String.raw`(\d+)\s*[x×]\s*(\d+)\s+${WEIGHT}`);
/** "185x5" — weight first, one set. */
const RE_WEIGHT_X_REPS = chunkRe(String.raw`${WEIGHT}\s*[x×]\s*(\d+)`);
/** "185 for 8" / "bw+25 for 8" */
const RE_WEIGHT_FOR_REPS = chunkRe(String.raw`${WEIGHT}\s+for\s+(\d+)`);
/** "3 sets 155x7" / "3 sets of 155 x 7" */
const RE_N_SETS_WEIGHT_X_REPS = chunkRe(
  String.raw`(\d+)\s*sets?(?:\s+of)?\s+${WEIGHT}\s*[x×]\s*(\d+)`,
);
/** "2 sets 20kg for 8" — the kg is already gone by the time this runs. */
const RE_N_SETS_WEIGHT_FOR_REPS = chunkRe(
  String.raw`(\d+)\s*sets?(?:\s+of)?\s+${WEIGHT}\s+for\s+(\d+)`,
);
/** A bare rep count continuing the previous weight: "8,8,6" — and "for 6". */
const RE_BARE_REPS = chunkRe(String.raw`(?:for\s+)?(\d+)`);

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

/** A weight token from any of the forms above, in lb. */
function weightOf(token: string, isKg: boolean): number {
  const bw = parseBodyweight(token);
  // Bodyweight's added load is written in whatever unit the line used, but a
  // bare "bw" is zero in both.
  return bw !== null ? toLb(bw, isKg && bw > 0) : toLb(Number(token), isKg);
}

function stripLeadingFiller(text: string): string {
  let out = text.trim();
  for (let guard = 0; guard < LEADING_FILLER.length * 2; guard++) {
    const before = out;
    for (const word of LEADING_FILLER) {
      const re = new RegExp(`^${word}\\b[\\s,]*`, "i");
      if (re.test(out)) {
        out = out.replace(re, "");
        break;
      }
    }
    if (out === before) break;
  }
  return out.trim();
}

/** `null` means the numbers are outside `SANITY` — the caller drops the chunk. */
function makeSet(
  reps: number,
  weightLb: number,
  rpe: number | null,
  flags: { toFailure: boolean; isWarmup: boolean },
): ParsedSet | null {
  if (!setWithinSanity(reps, weightLb)) return null;
  return {
    reps,
    weight_lb: weightLb,
    rpe,
    to_failure: flags.toFailure,
    is_warmup: flags.isWarmup,
  };
}

/** Structure recognised, numbers implausible. Drop the chunk, keep the line. */
const AMBIGUOUS = "ambiguous" as const;
/** Structure not recognised at all. Fail the line so the model sees it whole. */
const UNPARSED = "unparsed" as const;

function repeat(set: ParsedSet | null, count: number): ParsedSet[] | typeof AMBIGUOUS {
  if (!set) return AMBIGUOUS;
  if (!Number.isInteger(count) || count < 1 || count > SANITY.maxSetCount) return AMBIGUOUS;
  return Array.from({ length: count }, () => ({ ...set }));
}

function parseChunk(
  chunk: string,
  previous: ParsedSet | undefined,
  isKg: boolean,
  flags: { toFailure: boolean; isWarmup: boolean },
): ParsedSet[] | typeof AMBIGUOUS | typeof UNPARSED {
  const { rpe, rest } = extractRpe(chunk);
  const c = rest.trim().replace(/\s+/g, " ");

  // "3 sets 155x7" — N sets, weight, reps.
  let m = c.match(RE_N_SETS_WEIGHT_X_REPS);
  if (m) return repeat(makeSet(Number(m[3]), weightOf(m[2], isKg), rpe, flags), Number(m[1]));

  // "2 sets 20kg for 8"
  m = c.match(RE_N_SETS_WEIGHT_FOR_REPS);
  if (m) return repeat(makeSet(Number(m[3]), weightOf(m[2], isKg), rpe, flags), Number(m[1]));

  // "5x5 185" — sets x reps, then weight.
  m = c.match(RE_SETS_X_REPS_WEIGHT);
  if (m) return repeat(makeSet(Number(m[2]), weightOf(m[3], isKg), rpe, flags), Number(m[1]));

  // "185x5" — weight x reps, a single set.
  m = c.match(RE_WEIGHT_X_REPS);
  if (m) {
    const set = makeSet(Number(m[2]), weightOf(m[1], isKg), rpe, flags);
    return set ? [set] : AMBIGUOUS;
  }

  // "185 for 8" / "bw+25 for 8"
  m = c.match(RE_WEIGHT_FOR_REPS);
  if (m) {
    const set = makeSet(Number(m[2]), weightOf(m[1], isKg), rpe, flags);
    return set ? [set] : AMBIGUOUS;
  }

  // A bare rep count continues the previous set's weight: "8,8,6"
  m = c.match(RE_BARE_REPS);
  if (m && previous) {
    const set = makeSet(Number(m[1]), previous.weight_lb, rpe, flags);
    return set ? [{ ...previous, ...set }] : AMBIGUOUS;
  }

  return UNPARSED;
}

/**
 * Parse ONE exercise's worth of shorthand — one line, or one semicolon-
 * separated clause. Returns null when nothing set-shaped is found, which is the
 * signal to fall through to the model.
 */
export function parseEntry(input: string): ParsedEntry | null {
  const raw = stripLeadingFiller(input.trim());
  if (!raw) return null;

  // A unit suffix sits flush against the number ("100kg", "30kgx8"), where
  // there is no word boundary between the digit and the letter — so match on
  // the digit and on what follows the unit.
  const isKg = RE_IS_KG.test(raw);
  const flags = extractFlags(raw);
  const text = flags.rest
    .replace(RE_UNIT_AFTER_NUMBER, "$1 ")
    .replace(RE_UNIT_BARE, " ");

  // The exercise name is everything before the first numeric/bw token.
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  const firstNumeric = tokens.findIndex((t) => /^\d|^bw/i.test(t));
  if (firstNumeric <= 0) return null;

  const exercise = tokens.slice(0, firstNumeric).join(" ").trim();
  if (!exercise) return null;

  const body = text.slice(text.indexOf(tokens[firstNumeric]));
  const sets: ParsedSet[] = [];
  const dropped: string[] = [];

  // Split on commas and "then"/"and" — each chunk is one or more identical sets.
  for (const chunkRaw of body.split(/\s*(?:,|\bthen\b|\band\b)\s*/i)) {
    const chunk = chunkRaw.trim();
    if (!chunk) continue;

    const produced = parseChunk(chunk, sets[sets.length - 1], isKg, flags);
    if (produced === UNPARSED) return null; // let the model try the whole line
    if (produced === AMBIGUOUS) {
      // Recognised shape, unbelievable number. Dropping it is what turns the
      // owner's "165x5, 165,5" into two sets of 5 at 165 instead of one set of
      // 165 reps — and it never invents a value.
      dropped.push(chunk);
      continue;
    }
    sets.push(...produced);
  }

  if (sets.length === 0) return null;
  return dropped.length > 0
    ? { exercise_query: exercise, sets, dropped }
    : { exercise_query: exercise, sets };
}

/** One line of the input, either understood or handed on. */
export type LineResult =
  | { kind: "entry"; entry: ParsedEntry }
  | { kind: "unparsed"; line: string };

/**
 * Parse each line INDEPENDENTLY and report both halves.
 *
 * This is the fix for the owner's paste. Blank lines are separators, not
 * errors. A line this parser cannot read no longer poisons the lines it can:
 * it comes back under `unparsed` so the caller can send just that line to the
 * model and concatenate the results. Before this, one unsupported line sent the
 * entire paste — including four lines of perfectly good shorthand — to the
 * model, which is where the hallucinated numbers came from.
 */
export function parseLines(input: string): LineResult[] {
  return input
    .split(/[\n;]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const entry = parseEntry(line);
      return entry ? { kind: "entry" as const, entry } : { kind: "unparsed" as const, line };
    });
}

/**
 * All-or-nothing: "bench 5x5 185; squat 225x5" and newline-separated entries.
 *
 * Kept deliberately strict for callers that have no model to fall back on (the
 * web `SetLogger`): half a workout logged with no indication of what is missing
 * is worse than none of it. Callers that CAN reach the model should use
 * `parseLines` instead, which loses nothing.
 */
export function parseShorthand(input: string): ParsedEntry[] {
  const results = parseLines(input);
  if (results.some((r) => r.kind === "unparsed")) return [];
  return results.map((r) => (r as { kind: "entry"; entry: ParsedEntry }).entry);
}

/**
 * Round every weight to a whole pound.
 *
 * The owner's "20kg" rendered as "44.1 lb" and nobody loads a tenth of a pound.
 * This belongs at the DISPLAY edge, not in `parseEntry`: the parser keeps full
 * precision so the kg round-trip assertions stay exact, and `parse-sets.ts`
 * applies this on the way out, where the number the confirmation sheet shows is
 * also the number it will write back. Storage stays kg.
 */
export function roundSetsToDisplayLb<T extends { weight_lb: number }>(sets: T[]): T[] {
  return sets.map((s) => ({ ...s, weight_lb: Math.round(s.weight_lb) }));
}

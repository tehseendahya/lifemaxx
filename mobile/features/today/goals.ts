/*
 * Relative imports rather than `@/lib/...`, matching `model.ts` and every other
 * pure module in this app: `mobile/vitest.config.ts` runs in a plain node
 * environment and resolves `@` through one alias, but the convention here is
 * that a module which must be testable does not depend on build configuration
 * to be collected at all.
 */
import { kgToLb } from "../../lib/shared/units";
import type { CatalogueExercise } from "../../lib/types";

/**
 * Structure pulled out of the prose the owner typed into a textarea.
 *
 * The honest framing: `goals_text` is free text and will stay free text. This
 * does NOT parse it — it looks for four narrow, deterministic shapes and
 * reports everything else as unread. There is no model call (so this works in a
 * basement, instantly, for free) and no heuristic that can *invent* a target:
 * every number in a `GoalClaim` was typed by the owner.
 *
 * The failure mode being designed against is not "we missed a goal" — a missed
 * sentence lands in `rest` and is still shown, verbatim. It is "we matched the
 * wrong lift and computed a gap against a lift they never do", which is the
 * same class of error as a confident wrong fuzzy match in the confirm sheet,
 * and the owner has already told us how that feels. So the exercise matcher is
 * exact-token-containment with no fuzz at all, and would rather find nothing.
 */

export type GoalClaim =
  | { kind: "bodyweight"; sentence: string; targetLb: number; byDate: string | null }
  | {
      kind: "lift";
      sentence: string;
      exerciseId: string;
      exerciseName: string;
      targetLb: number;
      byDate: string | null;
    }
  | { kind: "run_distance"; sentence: string; distanceMi: number; byDate: string | null }
  | {
      kind: "run_time";
      sentence: string;
      distanceMi: number;
      targetSec: number;
      byDate: string | null;
    };

export interface GoalClaims {
  claims: GoalClaim[];
  /** Sentences no pattern matched. Shown verbatim, never reinterpreted. */
  rest: string[];
}

/** A weight written with its unit. kg is converted and rounded to whole lb. */
const WEIGHT_WITH_UNIT = /(\d{2,3}(?:\.\d)?)\s*(lb|lbs|pounds|kg)\b/i;

/** The same figure with the unit left off, which is how people actually write. */
const BARE_WEIGHT = /\b(\d{2,3}(?:\.\d)?)\b/;

/**
 * What makes a weight a bodyweight goal rather than a load.
 *
 * Closed list, not a heuristic. "bulk" and "cut" are in because they name the
 * direction without naming the scale.
 */
const BODYWEIGHT_CUE = /\b(weigh|weight|bodyweight|bulk|cut|get to|down to|up to)\b/i;

/** `h:mm`, `mm:ss` or `h:mm:ss`. Which one it is depends on the distance. */
const CLOCK = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/;

/**
 * The named race distances, longest first.
 *
 * Order matters for exactly one pair: `/marathon/` matches inside "half
 * marathon", so the half has to be tested first or every half-marathon goal
 * becomes a 26.2.
 */
const NAMED_DISTANCES: { re: RegExp; mi: number }[] = [
  { re: /\bhalf[\s-]?marathon\b/i, mi: 13.1 },
  { re: /\bmarathon\b/i, mi: 26.2 },
  { re: /\b10\s?k\b/i, mi: 6.2 },
  { re: /\b5\s?k\b/i, mi: 3.1 },
];

const MILES = /\b(\d{1,3}(?:\.\d)?)\s*(?:mi|mile|miles)\b/i;

/**
 * Words stripped from a catalogue name before matching.
 *
 * Only the four that name the implement and that nobody types when they are
 * talking about the lift. "press", "smith", "incline" and the rest stay in:
 * dropping them is how "incline smith press" and "bench press" come to look
 * like the same goal, and the owner has already been bitten by exactly that
 * confusion in the parser.
 */
const EQUIPMENT_WORDS = new Set(["barbell", "dumbbell", "machine", "cable"]);

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;

const tokenize = (text: string): string[] =>
  text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * `goals_text` → the claims that can be measured, plus everything else.
 *
 * `today` is a third parameter, which the brief's signature does not show, and
 * it is not optional by accident: "bench 225 by March" cannot be resolved to a
 * date without knowing what year it is, and reading `new Date()` here would
 * take the *device* clock while every other date in this app is the date in the
 * owner's profile timezone. On a phone that has travelled those differ, and a
 * deadline that moves depending on where you are standing is worse than no
 * deadline. Pass `bootstrap.today`.
 */
export function extractGoalClaims(
  goalsText: string,
  catalogue: CatalogueExercise[],
  today: string,
): GoalClaims {
  const sentences = goalsText
    .split(/[.;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const claims: GoalClaim[] = [];
  const rest: string[] = [];

  for (const sentence of sentences) {
    const claim = claimFor(sentence, catalogue, today);
    if (claim) claims.push(claim);
    else rest.push(sentence);
  }

  return { claims, rest };
}

/**
 * At most one claim per sentence, first pattern wins.
 *
 * Two deliberate departures from the brief's stated order, both because the
 * stated order makes a pattern unreachable:
 *
 *  1. `run_time` is tested BEFORE `run_distance`. A time goal is a distance
 *     goal plus a clock, so testing the looser shape first would mean
 *     "half marathon under 1:50" always came back as a bare distance target and
 *     the clock was never read.
 *  2. `bodyweight` is tested first, as specified, but is withheld when the
 *     sentence also names a catalogue exercise. "get my squat up to 315" has a
 *     bodyweight cue ("up to") and a weight, and reading it as a bodyweight
 *     target would be exactly the confident-wrong-match failure this module
 *     exists to avoid.
 */
function claimFor(
  sentence: string,
  catalogue: CatalogueExercise[],
  today: string,
): GoalClaim | null {
  const byDate = dateIn(sentence, today);
  const exercise = matchExercise(sentence, catalogue);

  if (exercise === null && BODYWEIGHT_CUE.test(sentence)) {
    const lb = weightLbIn(sentence);
    if (lb !== null) return { kind: "bodyweight", sentence, targetLb: lb, byDate };
  }

  if (exercise !== null) {
    const lb = weightLbIn(sentence);
    if (lb !== null) {
      return {
        kind: "lift",
        sentence,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        targetLb: lb,
        byDate,
      };
    }
  }

  const distanceMi = distanceMiIn(sentence);
  if (distanceMi !== null) {
    const targetSec = clockSecIn(sentence, distanceMi);
    if (targetSec !== null) {
      return { kind: "run_time", sentence, distanceMi, targetSec, byDate };
    }
    return { kind: "run_distance", sentence, distanceMi, byDate };
  }

  return null;
}

/**
 * The weight in a sentence, in whole lb.
 *
 * The unit-bearing form is tried first and is unambiguous. The bare form exists
 * because "bench press 225" is how it actually gets written, and it is read
 * only after clock tokens have been removed: without that, "half marathon under
 * 1:50" offers up "50" as a plausible two-digit weight.
 */
export function weightLbIn(sentence: string): number | null {
  const united = WEIGHT_WITH_UNIT.exec(sentence);
  if (united) {
    const value = Number(united[1]);
    return Math.round(united[2].toLowerCase() === "kg" ? kgToLb(value) : value);
  }

  const bare = BARE_WEIGHT.exec(sentence.replace(new RegExp(CLOCK.source, "g"), " "));
  return bare ? Math.round(Number(bare[1])) : null;
}

/** The race distance in a sentence, in miles. */
export function distanceMiIn(sentence: string): number | null {
  for (const { re, mi } of NAMED_DISTANCES) {
    if (re.test(sentence)) return mi;
  }
  const explicit = MILES.exec(sentence);
  return explicit ? Number(explicit[1]) : null;
}

/**
 * A clock token read against the distance it belongs to.
 *
 * `1:50` is an hour and fifty minutes on a half marathon and one minute fifty
 * on a 5k, and there is no way to tell which from the token. The distance is
 * the only disambiguator available, so 10 miles is the cut: nobody runs ten
 * miles in under an hour and nobody runs a 5k in over one.
 */
export function clockSecIn(sentence: string, distanceMi: number): number | null {
  const m = CLOCK.exec(sentence);
  if (!m) return null;

  const a = Number(m[1]);
  const b = Number(m[2]);
  if (m[3] !== undefined) return a * 3600 + b * 60 + Number(m[3]);
  return distanceMi >= 10 ? a * 3600 + b * 60 : a * 60 + b;
}

/**
 * The exercise a sentence names, or nothing.
 *
 * EVERY token of a catalogue name (minus the four equipment words) has to
 * appear in the sentence. Among the rows that qualify, most matched tokens
 * wins, and a tie goes to the longer name — so "smith machine incline press"
 * beats "incline press" when both are present, and "bench" on its own matches
 * neither "Barbell Bench Press" nor anything else.
 *
 * That last part is a real cost: "bench 225" produces no claim and lands in
 * `rest`. It is the right cost. The alternative is a fuzzy match, and a gap
 * computed against the wrong lift is a number the owner would act on.
 */
export function matchExercise(
  sentence: string,
  catalogue: CatalogueExercise[],
): CatalogueExercise | null {
  const words = new Set(tokenize(sentence));
  let best: { exercise: CatalogueExercise; matched: number } | null = null;

  for (const exercise of catalogue) {
    const tokens = tokenize(exercise.name).filter((t) => !EQUIPMENT_WORDS.has(t));
    if (tokens.length === 0) continue;
    if (!tokens.every((t) => words.has(t))) continue;

    const better =
      best === null ||
      tokens.length > best.matched ||
      (tokens.length === best.matched && exercise.name.length > best.exercise.name.length);
    if (better) best = { exercise, matched: tokens.length };
  }

  return best?.exercise ?? null;
}

/**
 * A deadline, or nothing.
 *
 * Never inferred from "soon", "this year", "eventually" or "in the fall" — a
 * countdown the owner did not ask for would be the app inventing pressure. A
 * bare month name resolves to the first of its NEXT occurrence, so "by October"
 * said in late October means next October rather than four days ago.
 */
export function dateIn(sentence: string, today: string): string | null {
  const iso = ISO_DATE.exec(sentence);
  if (iso) return iso[0];

  const lower = sentence.toLowerCase();
  let found: { at: number; month: number; year: string | undefined } | null = null;

  for (let i = 0; i < MONTHS.length; i += 1) {
    const m = monthPattern(MONTHS[i]).exec(lower);
    if (!m) continue;
    // "may" is also an ordinary English verb, and "I may add a deload" is not a
    // deadline. It only counts with a year or a day number after it.
    if (MONTHS[i] === "may" && m[1] === undefined && !/\bmay\s+\d/.test(lower)) continue;
    // The earliest month *in the sentence*, not the earliest in the calendar:
    // iterating MONTHS would otherwise let a stray "January" outrank the
    // "March" the owner actually wrote.
    if (found === null || m.index < found.at) {
      found = { at: m.index, month: i + 1, year: m[1] };
    }
  }

  if (found === null) return null;

  const month = String(found.month).padStart(2, "0");
  if (found.year !== undefined) return `${found.year}-${month}-01`;

  const year = Number(today.slice(0, 4));
  const candidate = `${year}-${month}-01`;
  return candidate >= today ? candidate : `${year + 1}-${month}-01`;
}

/**
 * The full name or its three-letter abbreviation, as a whole word.
 *
 * `\b` right after the name rather than `[a-z]*` is the whole point: a prefix
 * match would read "marathon" as March, and "half marathon in the fall" would
 * sprout a deadline the owner never wrote. "sept" gets its own form because it
 * is the one four-letter abbreviation in common use.
 */
function monthPattern(name: string): RegExp {
  const forms = [name, name.slice(0, 3)];
  if (name === "september") forms.push("sept");
  return new RegExp(`\\b(?:${forms.join("|")})\\b\\.?(?:\\s+(\\d{4}))?`);
}

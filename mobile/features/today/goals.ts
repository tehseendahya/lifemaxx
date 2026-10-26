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
 * does NOT parse it — it looks for five narrow, deterministic shapes and
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
  /**
   * A rep target on a named lift: "10 weighted pull ups with 45lb plate by May".
   *
   * A separate kind rather than a `lift` with an extra field, because nothing in
   * `bootstrap` can measure it — `lastSets` carries the modal set and
   * `history.mainLifts` carries e1RM points, and neither answers "most reps at
   * ≥45 lb". So this kind renders a fact beside a target and never computes a
   * gap. See `gapFor` in `model.ts`.
   */
  | {
      kind: "lift_reps";
      sentence: string;
      exerciseId: string;
      exerciseName: string;
      targetReps: number;
      /** The added load, when it was written with its unit. Null otherwise. */
      loadLb: number | null;
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

/**
 * What an unmatched sentence is, so the card can file it.
 *
 * `"aim"` is something the owner is working on with no number in it — "getting
 * arms to be bigger". `"context"` is a standing fact about how they train —
 * "Current split: chest, side delts, and biceps". The distinction exists
 * because they want different presentation (an aim is a goal, context is
 * background the coach reads), and for no other reason: both are shown
 * verbatim, neither is reinterpreted, and nothing downstream computes anything
 * from either. A misfile costs one line under the wrong heading, which is why
 * this is two regexes and not a model call.
 */
export type RestKind = "aim" | "context";

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
 * A rep count. Two shapes, both of which the owner writes.
 *
 * `LEADING_REPS` is anchored so it cannot fire on a weight: `\d{1,2}` then
 * whitespace means "205 bench press" fails the match outright (three digits),
 * while "10 weighted pull ups" takes it.
 */
const LEADING_REPS = /^\s*(\d{1,2})\s+/;
const EXPLICIT_REPS = /\b(\d{1,2})\s*reps?\b/i;

/**
 * Every weight-shaped figure in a sentence, in source order.
 *
 * Used only to find a SECOND dated target in one sentence. The unit group is
 * optional so "225 by May" is seen, and a figure touching a colon is dropped so
 * the minutes of a `1:50` are never offered as a weight — the same hazard
 * `weightLbIn` guards with its clock strip, handled here by position instead
 * because this scan has to report indices.
 */
const WEIGHT_SCAN = /\b(\d{2,3}(?:\.\d)?)\s*(lb|lbs|pounds|kg)?\b/gi;

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

/**
 * When a bare "may" is the month rather than the verb.
 *
 * A date preposition in front, or a day number behind. "I may add a deload"
 * and "maybe deload" take neither; "by May", "in May 2027" and "May 3" all do.
 */
const MAY_AS_MONTH = /\b(?:by|in|before|until|til|till|around|come)\s+may\b|\bmay\s+\d/i;

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
    const found = claimsFor(sentence, catalogue, today);
    if (found.length > 0) claims.push(...found);
    else rest.push(sentence);
  }

  return { claims, rest };
}

/**
 * Which heading an unmatched sentence belongs under.
 *
 * `context` when the sentence either opens with a short label ("Current
 * split:", "Schedule:", "Gym:") or carries a scheduling cue ("2x per week",
 * "every other day", "deload"). Everything else is an aim.
 *
 * Both of the owner's context lines match and their priorities line matches
 * neither, which is the whole test. Nothing is reinterpreted either way — this
 * only chooses a heading.
 */
export function restKind(sentence: string): RestKind {
  if (/^[A-Za-z][A-Za-z ]{0,20}:/.test(sentence)) return "context";
  if (SCHEDULE_CUE.test(sentence)) return "context";
  return "aim";
}

const SCHEDULE_CUE =
  /\b(\d+\s?x|\d+\s?times|per week|each week|every (day|week|other)|mon|tue|wed|thu|fri|sat|sun|split|schedule|rest day|deload)\b/i;

/**
 * The claims in one sentence. Usually none or one; two in exactly one case.
 *
 * Three deliberate departures from the brief's stated order, the first two
 * because the stated order makes a pattern unreachable:
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
 *  3. A sentence that names a lift AND carries a rep count is `lift_reps` and
 *     can never also be `lift`. This is a guard, not a preference. "10 weighted
 *     pull ups with 45lb plate by May" read as a weight target makes 45 lb the
 *     goal, and `gapFor` would then report an e1RM of 180 as `−135 lb`, tone
 *     `good` — an unmet goal rendered as achieved. The rep count is checked
 *     first and wins outright.
 */
function claimsFor(
  sentence: string,
  catalogue: CatalogueExercise[],
  today: string,
): GoalClaim[] {
  const byDate = dateIn(sentence, today);
  const exercise = matchExercise(sentence, catalogue);

  if (exercise === null && BODYWEIGHT_CUE.test(sentence)) {
    const lb = weightLbIn(sentence);
    if (lb !== null) return [{ kind: "bodyweight", sentence, targetLb: lb, byDate }];
  }

  if (exercise !== null) {
    const reps = repsIn(sentence);
    if (reps !== null) {
      return [{
        kind: "lift_reps",
        sentence,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        targetReps: reps,
        // Unit-bearing only. A bare figure in a rep sentence is far more often
        // another count ("3 sets of 10") than a load.
        loadLb: unitWeightLbIn(sentence),
        byDate,
      }];
    }

    const lb = weightLbIn(sentence);
    if (lb !== null) {
      const first: GoalClaim = {
        kind: "lift",
        sentence,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        targetLb: lb,
        byDate,
      };

      /*
       * "Main lifts: 205 bench press by December, 225 by May" is two goals on
       * one line, and the second one used to vanish silently. It is admitted
       * only when the fragment carrying it also carries a month or an ISO date:
       * without that guard "165x5, 165x5, 175x3" becomes four bench goals, and
       * a set log pasted into the goals box would quietly become a target list.
       */
      const second = secondTarget(sentence, today);
      if (second !== null) {
        return [first, { ...first, targetLb: second.targetLb, byDate: second.byDate }];
      }
      return [first];
    }
  }

  const distanceMi = distanceMiIn(sentence);
  if (distanceMi !== null) {
    const targetSec = clockSecIn(sentence, distanceMi);
    if (targetSec !== null) {
      return [{ kind: "run_time", sentence, distanceMi, targetSec, byDate }];
    }
    return [{ kind: "run_distance", sentence, distanceMi, byDate }];
  }

  return [];
}

/**
 * A rep count in a sentence.
 *
 * The explicit form is tried first so "bench 5 reps at 225" reads 5 and not the
 * 225 that `LEADING_REPS` could never reach anyway.
 */
export function repsIn(sentence: string): number | null {
  const explicit = EXPLICIT_REPS.exec(sentence);
  if (explicit) return Number(explicit[1]);

  const leading = LEADING_REPS.exec(sentence);
  return leading ? Number(leading[1]) : null;
}

/** The weight in a sentence, but only when it was written with its unit. */
export function unitWeightLbIn(sentence: string): number | null {
  const m = WEIGHT_WITH_UNIT.exec(sentence);
  if (m === null) return null;
  const value = Number(m[1]);
  return Math.round(m[2].toLowerCase() === "kg" ? kgToLb(value) : value);
}

/**
 * A second dated weight target in the same sentence, or nothing.
 *
 * Deliberately narrow: the second weight-shaped figure in source order, and
 * only when a month or ISO date follows it. A third is not read — one comma is
 * the pattern the owner writes and the one shape that has a test.
 */
function secondTarget(
  sentence: string,
  today: string,
): { targetLb: number; byDate: string } | null {
  const hits = weightHits(sentence);
  if (hits.length < 2) return null;

  const fragment = sentence.slice(hits[1].index);
  const byDate = dateIn(fragment, today);
  if (byDate === null) return null;

  return { targetLb: hits[1].lb, byDate };
}

function weightHits(sentence: string): { lb: number; index: number }[] {
  const re = new RegExp(WEIGHT_SCAN.source, "gi");
  const hits: { lb: number; index: number }[] = [];

  for (let m = re.exec(sentence); m !== null; m = re.exec(sentence)) {
    const after = sentence[m.index + m[0].length];
    // Part of a clock, not a weight. `1:50` offers "50" and nothing else does.
    if (sentence[m.index - 1] === ":" || after === ":") continue;

    const value = Number(m[1]);
    const kg = m[2] !== undefined && m[2].toLowerCase() === "kg";
    hits.push({ lb: Math.round(kg ? kgToLb(value) : value), index: m.index });
  }

  return hits;
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
  const united = unitWeightLbIn(sentence);
  if (united !== null) return united;

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
 * appear in the sentence. Among the rows that qualify, the winner is decided by
 * `rank` below — most matched tokens first, then whether the implement agrees
 * with the sentence, then the barbell default, then the shorter name.
 *
 * The equipment steps exist because of a real bug. Stripping the equipment
 * words reduces "Barbell Bench Press" and "Dumbbell Bench Press" to the same
 * `{bench, press}`, both matched "205 bench press by December" with two tokens,
 * and the old tie-break ("longer name wins") handed it to the dumbbell row by
 * one character. Every downstream number — the gap, the pace, the Lift tab's
 * goal chip — was then computed against a lift the owner does not do. Writing
 * "barbell" in the sentence changed nothing, because only the catalogue side
 * was ever looked at for equipment.
 *
 * ONE widening, added after the owner's "10 weighted pull ups with 45lb plate
 * by May" matched nothing: the sentence's word set also carries a singular form
 * of each of its own plural tokens, so "ups" reaches "Weighted Pull-Up" and
 * "curls" reaches "Preacher Curl". The catalogue side is untouched and the
 * every-token rule still holds — this adds words to the haystack, it does not
 * relax the needle, so no sentence matches a name it does not contain.
 *
 * When no catalogue name matches in full, `nicknameMatch` gets one try with a
 * four-row exact table ("bench", "squat", "deadlift"/"dl", "ohp"). This
 * deliberately reverses the earlier rule that "bench 225" matched nothing:
 * that is how the main lifts are actually written, and the table is narrow
 * enough that it can only ever name the barbell lift the word means.
 */
export function matchExercise(
  sentence: string,
  catalogue: CatalogueExercise[],
): CatalogueExercise | null {
  const words = withSingulars(tokenize(sentence));
  const said = equipmentIn(words);
  let best: { exercise: CatalogueExercise; rank: number[] } | null = null;

  for (const exercise of catalogue) {
    const nameTokens = tokenize(exercise.name);
    const tokens = nameTokens.filter((t) => !EQUIPMENT_WORDS.has(t));
    if (tokens.length === 0) continue;
    if (!tokens.every((t) => words.has(t))) continue;

    const rank = rankCandidate(nameTokens, tokens.length, words, said);
    if (rank === null) continue;

    // Strictly better only, so an exact tie keeps the earlier row: catalogue
    // order is the last, deterministic, tie-break.
    if (best === null || outranks(rank, best.rank)) best = { exercise, rank };
  }

  return best?.exercise ?? nicknameMatch(words, catalogue);
}

/**
 * Sentence-side spellings of an implement. "db" and "bb" are how the owner's
 * own aliases write them (see `src/db/catalogue.ts`), so a goal typed the same
 * way has to read the same way.
 */
const EQUIPMENT_ALIASES = new Map([["db", "dumbbell"], ["bb", "barbell"]]);

/** The implements the sentence names, normalised to the catalogue's words. */
function equipmentIn(words: Set<string>): Set<string> {
  const said = new Set<string>();
  for (const w of words) {
    if (EQUIPMENT_WORDS.has(w)) said.add(w);
    else {
      const alias = EQUIPMENT_ALIASES.get(w);
      if (alias !== undefined) said.add(alias);
    }
  }
  return said;
}

/**
 * A candidate's sort key, higher is better at each position, or null when the
 * candidate is ruled out.
 *
 *  1. Matched non-equipment tokens. "smith machine incline press" beats
 *     "incline press" because it says more of what was written.
 *  2. Equipment agreement. The sentence named an implement and this row names
 *     a different one → REJECTED, not merely ranked lower: "80 dumbbell bench
 *     press" must never fall back to the barbell lift just because the dumbbell
 *     row is missing. Named and shared → a point.
 *  3. The default implement. Nothing named → a row with no implement word, or
 *     with "barbell", gets a point. "Bench press" means the barbell lift; that
 *     is what every gym means by it.
 *  4. Fewer name tokens left unsaid, i.e. the shorter name. This replaces
 *     "longer name wins", which is the rule that picked the dumbbell row.
 */
function rankCandidate(
  nameTokens: string[],
  matched: number,
  words: Set<string>,
  said: Set<string>,
): number[] | null {
  const named = new Set(nameTokens.filter((t) => EQUIPMENT_WORDS.has(t)));

  let agrees = 0;
  if (said.size > 0 && named.size > 0) {
    const shared = [...named].some((t) => said.has(t));
    if (!shared) return null;
    agrees = 1;
  }

  const isDefault = said.size === 0 && (named.size === 0 || (named.size === 1 && named.has("barbell")))
    ? 1
    : 0;

  const unsaid = nameTokens.filter((t) => !words.has(t) && !said.has(t)).length;

  return [matched, agrees, isDefault, -unsaid];
}

/** Lexicographic: the first position that differs decides. */
function outranks(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/**
 * The four ways the main lifts get written without their full name, each to
 * exactly one catalogue slug. Exact words only — no prefix, no fuzz. A `Map`
 * rather than an object literal so a typed word like "constructor" cannot
 * reach a prototype property.
 */
const NICKNAMES = new Map([
  ["bench", "barbell-bench-press"],
  ["squat", "back-squat"],
  ["deadlift", "deadlift"],
  ["dl", "deadlift"],
  ["ohp", "overhead-press"],
]);

/**
 * Words that mean the nickname is not the plain barbell lift. "incline bench"
 * is not the bench press and "front squat" is not the back squat; if the
 * catalogue had that variant the full-name pass would already have found it,
 * so reaching here with a qualifier means the honest answer is nothing.
 *
 * "machine" and "cable" are added to the list the plan gave: they are the two
 * remaining implement words, and "machine bench 200" reading as the barbell
 * bench would be the same wrong-implement error this whole change fixes.
 */
const NICKNAME_QUALIFIERS = new Set([
  "incline", "decline", "close", "smith", "dumbbell", "db", "front", "box",
  "sumo", "romanian", "rdl", "trap", "machine", "cable",
]);

/**
 * Words that make a sentence about BODYWEIGHT, so a nickname in it is context
 * rather than the target.
 *
 * Without this, the nickname table turned "cut to 175 without losing my bench"
 * into a 175 lb bench goal: a nickname match counts as naming an exercise, and
 * naming an exercise is exactly what withholds the bodyweight reading in
 * `claimsFor`. The list is deliberately narrower than `BODYWEIGHT_CUE` — "up
 * to", "get to" and "down to" are left out because "get my squat up to 315"
 * says them too, and that one genuinely is a squat goal.
 */
const BODYWEIGHT_WORDS = new Set([
  "weigh", "bodyweight", "cut", "cutting", "bulk", "bulking", "lose", "losing",
]);

function nicknameMatch(
  words: Set<string>,
  catalogue: CatalogueExercise[],
): CatalogueExercise | null {
  for (const w of words) if (NICKNAME_QUALIFIERS.has(w)) return null;
  for (const w of words) if (BODYWEIGHT_WORDS.has(w)) return null;

  const slugs = new Set<string>();
  for (const w of words) {
    const slug = NICKNAMES.get(w);
    if (slug !== undefined) slugs.add(slug);
  }
  // "bench 225, squat 315" names two lifts. Picking one would attach both
  // numbers to whichever won, so a sentence naming two gets neither.
  if (slugs.size !== 1) return null;

  const [slug] = slugs;
  return catalogue.find((e) => e.slug === slug) ?? null;
}

/**
 * The tokens, plus a one-trailing-`s`-dropped form of each.
 *
 * The floor is three characters rather than the four the brief named, because
 * the case that motivated the whole change is "ups" → "up": at four, the one
 * sentence this exists for still matches nothing. Three keeps "as", "is" and
 * "us" from becoming single letters, which is where it would stop being
 * singularisation and start being fuzz.
 */
function withSingulars(tokens: string[]): Set<string> {
  const words = new Set(tokens);
  for (const t of tokens) {
    if (t.length >= 3 && t.endsWith("s")) words.add(t.slice(0, -1));
  }
  return words;
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
    // deadline. It counts with a year or a day number after it, or with a
    // preposition in front — which is the owner's own form, twice ("225 by
    // May", "45lb plate by May"), and which no modal use of the word takes.
    if (MONTHS[i] === "may" && m[1] === undefined && !MAY_AS_MONTH.test(lower)) continue;
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

/*
 * Relative imports, and `@/lib/*` only as `import type` — the same rule
 * `../today/verdict.ts` follows and for the same reason: `mobile/vitest.config.ts`
 * runs in a plain node environment, so a module that needs build configuration
 * resolved before it can be collected does not get tested at all. `import type`
 * is erased by esbuild, so the alias never has to resolve.
 *
 * Everything the Lift page prints when a session is NOT running is decided
 * here: which muscles are named, in what order, with what figures, and every
 * sentence shown when there is nothing to name. There is no simulator in this
 * container, so a string that is not asserted in `next.test.ts` is a string
 * nobody has ever seen.
 *
 * ── WHAT THIS MODULE IS NOT ────────────────────────────────────────────────
 *
 * It does not name a day, a split, a routine or a program, and it prescribes no
 * sets, reps or weight. There is no program object in this app and this is not
 * where one gets introduced. "What should I train today" is answered by the
 * muscle-debt ranking the server already computed, plus the exercise picker —
 * which pins the owed lifts itself. That is the whole answer.
 */

import { WEEKLY_SET_TARGET, deriveWorkoutName } from "../../lib/shared/muscles";
import type { CountedSet } from "../../lib/shared/muscles";
import type { Bootstrap, LastSet, RankedMuscle } from "../../lib/types";
import { extractGoalClaims } from "../today/goals";
import { formatShortDate, liftDaysIn, plural, strengthRows } from "../today/model";
import type { StrengthRow } from "../today/model";
import { LIFT_DAY_WINDOW, RECOVERED_DAYS } from "../today/verdict";
import { OWED_CONTRIBUTION_FLOOR, OWED_SCORE_THRESHOLD, fmtWeight, relativeDay } from "./logic";

// ---------------------------------------------------------------- constants

/**
 * How many owed muscles the card names.
 *
 * Two, not three. With one logged session fifteen muscles tie at the top of
 * `ranked` — `scoreMuscle` gives a never-trained muscle `debt 1 × recovery 1 =
 * 1.0` — so a third row is not a third-most-useful answer, it is the third
 * entry in `MUSCLES` declaration order presented as a decision.
 */
export const NEXT_UP_LIMIT = 2;

/** How many of the never-logged muscles are named before the count takes over. */
export const GAP_NAMED_LIMIT = 3;

/**
 * Lift days below which the card says what it is working from.
 *
 * It CAVEATS; it never refuses. Matching `THIN_SAMPLE_DAYS` in
 * `src/lib/llm/prompts.ts`, which is the coach's trend-claim floor, so the two
 * surfaces agree about the word "thin" — but the consequence here is one extra
 * muted line, not a withheld answer. The rule this replaces suppressed the one
 * output the page exists to produce for the whole of a new account's first
 * month.
 */
export const THIN_LIFT_DAYS = 5;

// ------------------------------------------------------------------- shared

/** Always one decimal: a column of `7` and `3.5` does not line up, `7.0` does. */
const fmt1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `"2026-12-01"` → `"Dec"`. String arithmetic, so no timezone can shift it. */
function monthShort(iso: string): string | null {
  const month = Number(iso.slice(5, 7));
  return Number.isInteger(month) && month >= 1 && month <= 12 ? MONTHS_SHORT[month - 1] : null;
}

// ------------------------------------------------------- block 1: what to train

export interface NextUpRow {
  muscle: string;
  label: string;
  /** `3.5 of 10 sets · last hit 4d ago`. A figure, a unit and a reason. */
  detail: string;
}

export interface NextUp {
  /** Tier 1: muscles with real debt. At most `NEXT_UP_LIMIT`. */
  rows: NextUpRow[];
  /**
   * Tier 2: one line for the muscles that have never been logged at all.
   *
   * A coverage gap is not a debt and the two must not share a list: a muscle
   * trained once and left short has a figure behind it, and a muscle with
   * nothing logged has only `MUSCLES` declaration order behind it.
   */
  gap: string | null;
  /**
   * What the card says INSTEAD of rows when there are none. Never null while
   * `rows` is empty, so the card is never blank and never reads as a shrug.
   */
  note: string | null;
  /** The thin-data caveat. A statement of what this is working from, never a refusal. */
  caveat: string | null;
}

/**
 * How many catalogue exercises train a muscle at all meaningfully.
 *
 * A deterministic trainability proxy, and the reason tier 2 names Biceps (31
 * exercises) and Abs (16) ahead of Abductors (1). The alternative was a
 * hard-coded denylist of forearm/adductor/abductor; this needs no magic list
 * and shrinks on its own as the owner logs more.
 */
function trainability(b: Bootstrap): Map<string, number> {
  const counts = new Map<string, number>();
  for (const exercise of b.catalogue) {
    for (const m of exercise.muscles) {
      if (m.contribution < OWED_CONTRIBUTION_FLOOR) continue;
      counts.set(m.muscle, (counts.get(m.muscle) ?? 0) + 1);
    }
  }
  return counts;
}

export function nextUpBlock(b: Bootstrap): NextUp {
  const ranked = b.volume.ranked;

  /*
   * `ranked` arrives sorted by the server's `score` and is NOT re-ranked here.
   * `verdict.ts` documents why at length: the projection that crossed the wire
   * dropped `weakShare`, so a second ranking computed on device would disagree
   * with the laptop about the same muscle on the same day.
   */
  const rows = ranked
    .filter((r) => r.score > OWED_SCORE_THRESHOLD && r.daysSinceTrained !== null)
    .slice(0, NEXT_UP_LIMIT)
    .map((r) => ({ muscle: r.muscle, label: r.label, detail: debtDetail(r) }));

  const never = ranked.filter((r) => r.daysSinceTrained === null);
  const counts = trainability(b);
  const ordered = [...never].sort(
    (a, c) =>
      (counts.get(c.muscle) ?? 0) - (counts.get(a.muscle) ?? 0) ||
      a.label.localeCompare(c.label),
  );

  // Nothing has ever been logged. The gap line would then be the whole ranking
  // restated as a deficiency, which is a worse way of saying "start here".
  const blank = ranked.length === 0 || never.length === ranked.length;

  const liftDays = liftDaysIn(b.history.days, b.today, LIFT_DAY_WINDOW);

  return {
    rows,
    gap: blank ? null : gapLine(ordered),
    note: rows.length > 0 ? null : emptyNote(ranked, blank),
    caveat:
      liftDays < THIN_LIFT_DAYS
        ? `From ${plural(liftDays, "logged day")} — this sharpens every session.`
        : null,
  };
}

function debtDetail(r: RankedMuscle): string {
  const days = r.daysSinceTrained ?? 0;
  // `0` cannot reach here — the server's recovery gate zeroes the score of
  // anything trained today — but a filter and a formatter two files apart is
  // not a thing to leave implicit.
  const when = days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;
  return `${fmt1(r.setsLast7d)} of ${WEEKLY_SET_TARGET.min} sets · last hit ${when}`;
}

function gapLine(ordered: RankedMuscle[]): string | null {
  const n = ordered.length;
  if (n === 0) return null;

  const named = ordered.slice(0, GAP_NAMED_LIMIT).map((r) => r.label);
  const head = `${plural(n, "muscle")} ${n === 1 ? "has" : "have"} nothing logged yet`;

  return n > GAP_NAMED_LIMIT
    ? `${head} — ${named.join(", ")} and ${n - GAP_NAMED_LIMIT} more.`
    : `${head} — ${named.join(", ")}.`;
}

/**
 * The three ways tier 1 can be empty, each stated rather than shrugged at.
 *
 * None of them is an error and none of them is a blank card. The recovery case
 * is the owner's state on the evening of a session: everything they are short
 * on, they trained hours ago, and the honest answer is that there is nothing to
 * rank today.
 */
function emptyNote(ranked: RankedMuscle[], blank: boolean): string {
  if (blank) {
    return "Nothing logged yet. Log a session and this card ranks the muscles you owe sets to.";
  }

  const heldBack = ranked.some(
    (r) =>
      r.daysSinceTrained !== null &&
      r.daysSinceTrained < RECOVERED_DAYS &&
      r.setsLast7d < WEEKLY_SET_TARGET.min,
  );

  return heldBack
    ? "Everything you're short on was trained in the last two days. Train what you like, or rest."
    : "Nothing you've trained is short on sets this week. Train what you like, or rest.";
}

// -------------------------------------------------------- block 2: last session

export interface LastSessionRow {
  exerciseId: string;
  name: string;
  sets: number;
  /** `165 × 5 × 4 sets @7`. */
  detail: string;
}

export interface LastSession {
  /** `YYYY-MM-DD`. */
  date: string;
  /** `deriveWorkoutName`'s output — "Push — Chest & Front Delts". */
  name: string;
  /** `4d ago · 21 Oct`. */
  when: string;
  rows: LastSessionRow[];
  /** `rows` in the same order, for seeding a repeat. */
  exerciseIds: string[];
}

/**
 * The last completed session, from `bootstrap.lastSets` only.
 *
 * No new endpoint: `lastSets[id].localDate` is already that exercise's most
 * recent completed workout, so the newest of those dates IS the last session
 * and the entries carrying it are its lifts.
 *
 * The one consequence worth stating: `lastSetPerExercise` filters
 * `workouts.status = "completed"`, so a session still open does not appear
 * here. That is correct for this card — it offers a repeat, and repeating a
 * session that is currently running is not a thing to offer.
 *
 * Returns `null` rather than an empty block, because "no completed sessions
 * yet" is a different sentence from "a session with no lifts in it".
 */
export function lastSessionBlock(b: Bootstrap): LastSession | null {
  const entries = Object.entries(b.lastSets ?? {});
  if (entries.length === 0) return null;

  let date = "";
  for (const [, s] of entries) if (s.localDate > date) date = s.localDate;

  const byId = new Map(b.catalogue.map((e) => [e.id, e]));

  /*
   * By set count descending, then name. There is no session order in
   * `lastSets` — it is a map keyed by exercise — so any order here is derived
   * and must not imply the sequence the lifts were actually performed in.
   */
  const rows = entries
    .filter(([, s]) => s.localDate === date)
    .map(([id, s]) => ({
      exerciseId: id,
      // A `lastSets` entry can outlive the cached catalogue: the set may have
      // been logged on the web since this bootstrap came down. Naming it
      // honestly beats an empty row.
      name: byId.get(id)?.name ?? "Exercise",
      sets: s.sets,
      detail: setLine(s),
    }))
    .sort((a, c) => c.sets - a.sets || a.name.localeCompare(c.name));

  const counted: CountedSet[] = [];
  for (const row of rows) {
    // `MuscleContributionDto.muscle` is `string` over the wire and `Muscle` in
    // the domain. The cast is the narrowing one and nothing downstream trusts
    // it: an unknown key only ever misses a label lookup.
    const muscles = (byId.get(row.exerciseId)?.muscles ?? []) as CountedSet["muscles"];
    for (let i = 0; i < Math.max(0, Math.round(row.sets)); i += 1) counted.push({ muscles });
  }

  return {
    date,
    name: deriveWorkoutName(counted),
    when: `${relativeDay(date, b.today)} · ${formatShortDate(date)}`,
    rows,
    exerciseIds: rows.map((r) => r.exerciseId),
  };
}

/**
 * `165 × 5 × 4 sets @7`.
 *
 * `lastLine` is deliberately not reused: its `LAST:` prefix and trailing
 * relative day are for the mid-session card, where the row has no header to
 * carry either.
 */
const setLine = (s: LastSet): string =>
  `${fmtWeight(s.weightLb)} × ${s.reps} × ${plural(s.sets, "set")}` +
  (s.rpe !== null ? ` @${s.rpe}` : "");

// --------------------------------------------------------- block 3: main lifts

export interface MainLiftRow extends StrengthRow {
  /** `→ 205 by Dec`, when a goal the owner typed targets this lift. Else null. */
  goal: string | null;
}

/**
 * The same three lifts Today shows, plus the one thing that earns this card its
 * place on the Lift page rather than being a copy: the target the owner wrote
 * down for that lift, next to the trend that has to get there.
 *
 * `../today/goals` is imported directly rather than moved. A file move would
 * put two engineers in one file this round, and the module is already the
 * single parser for the owner's prose.
 */
export function mainLiftRows(b: Bootstrap): MainLiftRow[] {
  const targets = new Map<string, { targetLb: number; byDate: string | null }>();

  for (const claim of extractGoalClaims(b.goalsText, b.catalogue, b.today).claims) {
    // Only a weight target. A rep target ("10 weighted pull ups with 45lb")
    // is not an e1RM and a chip reading `→ 45 by May` on a lift the owner can
    // already do 180 on would be worse than no chip.
    if (claim.kind !== "lift") continue;

    // The nearest deadline wins: "205 by December, 225 by May" is two claims on
    // one lift, and December is the one that decides this week's sessions.
    const held = targets.get(claim.exerciseId);
    if (held === undefined || sooner(claim.byDate, held.byDate)) {
      targets.set(claim.exerciseId, { targetLb: claim.targetLb, byDate: claim.byDate });
    }
  }

  return strengthRows(b).map((row) => {
    const target = targets.get(row.exerciseId);
    const month = target?.byDate !== undefined && target.byDate !== null
      ? monthShort(target.byDate)
      : null;

    return {
      ...row,
      goal:
        target === undefined
          ? null
          : month !== null
            ? `→ ${fmtWeight(target.targetLb)} by ${month}`
            : `→ ${fmtWeight(target.targetLb)} lb`,
    };
  });
}

/** A dated claim beats an undated one; between two dates, the earlier wins. */
const sooner = (a: string | null, b: string | null): boolean =>
  a !== null && (b === null || a < b);

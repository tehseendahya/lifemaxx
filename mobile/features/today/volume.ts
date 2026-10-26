/*
 * Relative imports rather than `@/lib/...`, for the same reason `model.ts` and
 * `verdict.ts` use them: `mobile/vitest.config.ts` runs in a plain node
 * environment, and the whole value of keeping this module free of
 * `react-native` is that every figure it prints can be asserted. A module that
 * needs build configuration before it can be tested does not get tested.
 */
import { WEEKLY_SET_TARGET, volumeStatus } from "../../lib/shared/muscles";
import { weekStartOf } from "../../lib/shared/running";
import type { Bootstrap } from "../../lib/types";
import { LOAD_WEEKS, formatShortDate, plural, shiftIso } from "./model";

/**
 * The card that replaced "Weekly hard sets".
 *
 * The owner's complaint was one sentence: "I don't get this weekly hard sets
 * thing. What's the y axis." It was the right complaint. That card drew eight
 * weekly buckets of whole working sets — muscle-blind — at 60pt with no y
 * number anywhere on it, so with one logged session it was seven baseline ticks
 * and one bar, and nothing on screen said what the height meant.
 *
 * Worse than unlabelled, it was the wrong measure. A weekly total that ignores
 * *which* muscle answers no question the owner has, while the ranking the rest
 * of the app runs on — "what am I short on" — is entirely per-muscle. The 8-week
 * set total is not re-homed anywhere by this module, on purpose: the per-muscle
 * week is the same data in the shape the ranking already uses.
 *
 * So: sets per muscle for the last 7 days, each against the productive range,
 * plus an 8-week calendar of lift days (now drawn by "This month"). Both answer "what's the y axis" by not
 * having one — the first is a meter with its band labelled in words above it,
 * the second is a heatmap where a cell is a day.
 *
 * ── THE NUMBERS ARE NOT NEW ────────────────────────────────────────────────
 *
 * `WEEKLY_SET_TARGET` (10–20) and `volumeStatus()` come from
 * `src/lib/domain/muscles.ts` and already drive `rankMuscles`, the weekly
 * balance view and the debt score. The volume-landmark literature the band
 * sanity-checks against (MEV ~8-10, MAV ~10-20, MRV ~18-30 sets/week) is why
 * 10–20 was the right pair to begin with, and it is not a reason to introduce a
 * second set of thresholds here. There is no new constant in this file that
 * encodes a training opinion.
 *
 * ── WHAT IS NOT COMPUTABLE, AND THEREFORE NOT HERE ─────────────────────────
 *
 * Per-muscle data exists for the LAST 7 DAYS ONLY. `bootstrap.volume.ranked` is
 * `getMuscleVolume`'s output over a 7-day window; `history.days[].hardSets` is
 * muscle-blind whole sets. A per-muscle trend, a week-over-week delta or a
 * "weeks in range" figure is not derivable from either without a new bootstrap
 * field, and faking one out of `history.days` would be inventing the exact
 * thing the owner could not read. The 8-week question is answered by the
 * strength card's e1RM trends and the run-miles card, not by this one.
 *
 * Which is why the per-muscle panel deliberately does NOT change shape with
 * more data: at one week it is three rows and a footer, at eight weeks it is
 * eight rows and a smaller footer. The band starts doing real work; the layout
 * does not move.
 */

/** Below this a muscle with real history is not worth a row of its own. */
const OWED_SCORE_FLOOR = 0.2;

/**
 * Rows cap. Eighteen muscles is the list the old Lift tab printed and the
 * owner did not read; eight is a card you can take in at a glance.
 */
export const VOLUME_ROWS_MAX = 8;

/**
 * The grid's weeks. Tied to the load card's buckets rather than written again:
 * two "8 weeks" labels on one screen that disagree by one bucket is a bug
 * nobody would ever report.
 */
export const GRID_WEEKS = LOAD_WEEKS;

/** Monday-start, which is what `weekStartOf` means by a week. */
const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"] as const;

/**
 * The one line under the card's label, always rendered.
 *
 * It used to be the two sentences now in `VOLUME_HOW_COUNTED`, permanently on
 * screen. That was the literal fix for "what's the y axis", and it worked — but
 * a paragraph of method above the rows every single day is the card explaining
 * itself to someone who already read it. So the band is named in one line and
 * the weighting is one tap away.
 */
export const VOLUME_EXPLAINER =
  `Weekly working sets per muscle against the ${WEEKLY_SET_TARGET.min}–${WEEKLY_SET_TARGET.max} `
  + "productive range.";

/**
 * What "How it's counted" expands to.
 *
 * The figure is a weighted sum, which is not guessable from a label, and the
 * band is an opinion the app holds, which is not guessable from a shaded
 * rectangle. "MEV", "MAV" and "MRV" are deliberately absent: the owner is not
 * reading Israetel, and "the productive range" is the same information in words
 * they already use.
 */
export const VOLUME_HOW_COUNTED =
  "Working sets weighted by how much each lift trains the muscle — a bench press "
  + "counts 1 chest, ½ front delt, ½ tricep. "
  + `The band is ${WEEKLY_SET_TARGET.min}–${WEEKLY_SET_TARGET.max} sets a week, `
  + "the productive range.";

export interface VolumeRow {
  /** `RankedMuscle.muscle` — the stable key, and the React key. */
  muscle: string;
  label: string;
  /** Fractional sets over the last 7 days. */
  sets: number;
  /** Always one decimal, so a `tnum` column of `7.0` and `3.5` aligns. */
  value: string;
  status: "under" | "in_range" | "over";
}

export interface VolumeTick {
  label: string;
  /** 0..1 of the track's width. */
  fraction: number;
}

export interface LiftDayCell {
  date: string;
  /**
   * `lifted` is a day with at least one working set. `past` is a day that has
   * happened and has none — it must read as *zero*, not as missing, which is
   * the whole point of the panel. `future` is the rest of the current week and
   * draws nothing at all.
   */
  state: "lifted" | "past" | "future";
}

export interface LiftDayGrid {
  /** Seven column headers. Duplicated letters, so render by index. */
  weekdays: readonly string[];
  /** Eight rows of seven, oldest week first. */
  weeks: LiftDayCell[][];
  days: number;
  /** "1 day" / "12 days", for the panel's right end label. */
  rightLabel: string;
}

export interface VolumeBlock {
  /** One line, always on screen. */
  explainer: string;
  /** The long version, behind the "How it's counted" toggle. */
  howCounted: string;
  /** Empty in both empty states; `note` carries the card instead. */
  rows: VolumeRow[];
  /** The band, restated so the screen needs no import of its own. */
  min: number;
  max: number;
  /** Top of the x domain. See `RangeBar`'s own note on why it self-scales. */
  domainMax: number;
  /** `0` / `10` / `20`, rendered ONCE per card rather than once per row. */
  ticks: VolumeTick[];
  /** A bare count of what is not shown, with no names. Null when nothing is. */
  footer: string | null;
  /** Replaces the rows. Null in the ordinary case. */
  note: string | null;
  /** The one primary action. Both destinations are the Lift tab. */
  navLabel: string;
}

export function volumeBlock(b: Bootstrap): VolumeBlock {
  const { min, max } = WEEKLY_SET_TARGET;
  const ranked = b.volume.ranked;

  const trained = ranked.filter((r) => r.setsLast7d > 0);

  /*
   * Muscles with nothing this week but real history and real debt. They are
   * appended AFTER every trained muscle rather than ranked in among them,
   * because the two halves of the card answer different questions: the first is
   * "how much did this get", the second is "this got none and is owed". A
   * never-logged muscle is in neither — that is a coverage gap rather than a
   * debt, it is named exactly once in the app (the Lift tab's NEXT UP card),
   * and this card contributes only its count to the footer. Two screens that
   * name and rank the same gap differently is how they come to disagree.
   */
  const owed = ranked.filter(
    (r) => r.setsLast7d === 0
      && r.score > OWED_SCORE_FLOOR
      && r.daysSinceTrained !== null,
  );

  /*
   * Nothing at all in the window is an empty state, not a card of zeroes.
   * Rendering `owed` on its own here would draw eighteen empty tracks under a
   * sentence about weighted sets, which is the noise the old chart had.
   */
  const picked = trained.length === 0
    ? []
    : [
      ...[...trained].sort((x, y) => y.setsLast7d - x.setsLast7d),
      ...[...owed].sort((x, y) => y.score - x.score),
    ].slice(0, VOLUME_ROWS_MAX);

  const rows: VolumeRow[] = picked.map((r) => ({
    muscle: r.muscle,
    label: r.label,
    sets: r.setsLast7d,
    value: (Math.round(r.setsLast7d * 10) / 10).toFixed(1),
    status: volumeStatus(r.setsLast7d),
  }));

  const domainMax = Math.max(max, ...rows.map((r) => r.sets));

  const liftDays = b.history.days.filter((d) => d.hardSets > 0);
  const lastLiftDate = liftDays.length > 0
    ? liftDays.reduce((latest, d) => (d.date > latest ? d.date : latest), liftDays[0].date)
    : null;

  const everLifted = lastLiftDate !== null;

  let note: string | null = null;
  if (rows.length === 0) {
    note = everLifted && lastLiftDate !== null
      /*
       * The owner's state whenever their one session is more than a week old.
       * It must not read as "you have no data" — they have data, it is just
       * outside this window, and the lift-day grid in "This month" is the
       * panel that has something to say in exactly this case.
       */
      ? `Nothing in the last 7 days. Your last session was ${formatShortDate(lastLiftDate)}.`
      : "Nothing logged yet. Log a session and every muscle you trained appears here "
        + `against the ${min}–${max} set range.`;
  }

  return {
    explainer: VOLUME_EXPLAINER,
    howCounted: VOLUME_HOW_COUNTED,
    rows,
    min,
    max,
    domainMax,
    ticks: [
      { label: "0", fraction: 0 },
      { label: String(min), fraction: min / domainMax },
      { label: String(max), fraction: max / domainMax },
    ],
    footer: rows.length === 0 ? null : footerFor(ranked, rows),
    note,
    navLabel: everLifted ? "What to train next →" : "Start a lift →",
  };
}

/**
 * What the cap and the window left out, as a count and never as names.
 *
 * Three branches because the common shape changes with the owner's training.
 * Today, three muscles have sets and fifteen have never been touched, so the
 * omitted rows are all zeroes and the sentence can say so. At eight weeks on
 * their split, fourteen-odd muscles have sets in a week and the cap of eight
 * starts cutting *trained* ones — claiming those have "nothing in the last 7
 * days" would be false, which is why this is not one format string.
 */
function footerFor(
  ranked: Bootstrap["volume"]["ranked"],
  rows: VolumeRow[],
): string | null {
  const shown = new Set(rows.map((r) => r.muscle));
  const omitted = ranked.filter((r) => !shown.has(r.muscle));
  if (omitted.length === 0) return null;

  const silent = omitted.filter((r) => r.setsLast7d === 0).length;
  if (silent === omitted.length) {
    return `${plural(omitted.length, "more muscle")}: nothing in the last 7 days.`;
  }
  if (silent === 0) {
    return `${plural(omitted.length, "more muscle")} trained this week, below these.`;
  }
  return `${plural(omitted.length, "more muscle")}, ${silent} with nothing in the last 7 days.`;
}

/**
 * Eight Monday-start weeks of "did I lift", as a calendar.
 *
 * Rendered by Today's "This month" card, not by sets-per-muscle any more: the
 * two answer different questions ("where did this week's sets land" against
 * "am I turning up"), and stacking them in one card was what made it read as
 * one long, unclear thing.
 *
 * A heatmap rather than a bar chart because it has no y axis to misread — which
 * is the complaint this whole card answers. A cell is a day; it is filled or it
 * is not. With one logged session that is one filled cell in fifty-six and the
 * weekday header says which day, which is legible, honest, and the one thing on
 * the card that visibly improves every single week.
 *
 * The grid always fits inside `history.days`' 56-day window and never shows an
 * "unknown" cell: the first Monday is `weekStartOf(today) − 49`, and
 * `weekStartOf(today)` is at most 6 days before today, so the earliest cell is
 * at worst `today − 55` — the window's first day.
 */
export function liftDayGrid(b: Bootstrap): LiftDayGrid {
  const lifted = new Set(
    b.history.days.filter((d) => d.hardSets > 0).map((d) => d.date),
  );
  const firstMonday = shiftIso(weekStartOf(b.today), -7 * (GRID_WEEKS - 1));

  const weeks: LiftDayCell[][] = [];
  let days = 0;

  for (let w = 0; w < GRID_WEEKS; w += 1) {
    const row: LiftDayCell[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = shiftIso(firstMonday, w * 7 + d);
      const hit = lifted.has(date);
      if (hit) days += 1;
      row.push({
        date,
        state: hit ? "lifted" : date <= b.today ? "past" : "future",
      });
    }
    weeks.push(row);
  }

  return {
    weekdays: WEEKDAY_INITIALS,
    weeks,
    days,
    // `plural` rather than the `${n} days` the spec wrote: the owner's current
    // state is exactly one, and "1 days" on the first card they see is the kind
    // of detail that makes the rest of the figures look unchecked.
    rightLabel: plural(days, "day"),
  };
}

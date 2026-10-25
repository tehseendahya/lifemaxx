/*
 * The imports below are relative rather than `@/lib/...`, which is the only
 * place in this feature that deviates from the alias convention. The reason is
 * that `mobile/vitest.config.ts` runs in a plain node environment, and the whole
 * point of keeping this module free of `react-native` imports is that it can be
 * unit-tested. A module that needs build configuration before it can be tested
 * does not get tested.
 */
import { averagePaceSecPerMile, miles, weekStartOf, weeklyRunStats } from "../../lib/shared/running";
import { weightTrend } from "../../lib/shared/tdee";
import { kgToLb } from "../../lib/shared/units";
import type { Bootstrap, HistoryDay } from "../../lib/types";
import { extractGoalClaims, type GoalClaim } from "./goals";

/**
 * `bootstrap` → the Today dashboard, as plain data.
 *
 * What this screen used to be: `totals` and `target` restated from the Food
 * tab, `volume.summary` restated from the Lift tab, and the week's mileage
 * restated from the Runs tab. The owner's complaint was exact — it "just
 * repeats things". So nothing on this screen now prints today's kcal, today's
 * protein, or a per-muscle `n/10 sets` row; those live one tap away and are
 * owned there.
 *
 * What replaced them is the four things no other tab can show, because no other
 * tab holds both halves of the data: where the body is going (bodyweight
 * against measured intake), what the owner wrote down that they are training
 * for and how far off it is, whether the lifts are actually moving, and whether
 * the work is going in at all. The verdict sentence (`verdict.ts`) is the
 * headline; these four are its evidence.
 *
 * Everything here is pure and tested. There is no simulator in this container,
 * so a figure that is not asserted in `model.test.ts` is a figure nobody has
 * ever seen.
 */

/** The trajectory card's window. Matches the TDEE regression's own 28 days. */
export const TRAJECTORY_DAYS = 28;
/** The load card's buckets, and the strength card's label. */
export const LOAD_WEEKS = 8;
/** The intake panel's smoothing window. */
export const INTAKE_MEAN_DAYS = 7;
/**
 * How many real intake days a trailing window needs before it draws a mean.
 *
 * Two is not a seven-day average, it is two days wearing one's label. Three is
 * the floor at which the line stops jumping by 800 kcal every time a single day
 * enters or leaves the window.
 */
export const MIN_INTAKE_DAYS_FOR_MEAN = 3;
/** Below this the trajectory card has no shape to draw, only a count. */
export const MIN_WEIGH_INS_FOR_TREND = 2;
/** `estimateTdee` needs seven intake days; the consistency card says so. */
export const TDEE_INTAKE_DAYS_NEEDED = 7;
/** The verdict's own floor, restated on the consistency card. */
export const CONSISTENCY_WINDOW_DAYS = 28;

// ------------------------------------------------------------------ dates

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

/** Days since the epoch — the x axis of every date-scaled chart here. */
export const dayNumber = (iso: string): number =>
  Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

export function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * "Saturday, October 25" from a `YYYY-MM-DD`.
 *
 * Deliberately NOT `toLocaleDateString`, which reads the *device* clock while
 * `bootstrap.today` is the date in the owner's profile timezone. On a phone
 * that has travelled, the header would name a different day than the data
 * underneath it. This is also pure and does not depend on which ICU build
 * Hermes was compiled with.
 */
export function formatLongDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "19 Oct" — the x-axis end label on every chart on this screen. */
export function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/**
 * "1:50" under an hour, "2:03" over it.
 *
 * Seconds are dropped above the hour on purpose: that is how the owner writes a
 * half-marathon target ("sub 1:50"), and printing "1:50:00" back at them would
 * read as a precision the projection does not have.
 */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    return `${h}:${String(Math.round((s - h * 3600) / 60)).padStart(2, "0")}`;
  }
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const plural = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Muscle labels are mostly plural — "Rear Delts", "Lats", "Quads",
 * "Hamstrings", "Calves" — and three are not: "Chest", "Upper Back",
 * "Lower Back". 15 of the 18 are plural, so a hard-coded "is" was wrong far
 * more often than it was right, and the verdict sentence read "Rear Delts is
 * 10 sets short".
 *
 * Testing the last letter is enough for this closed set and nothing else:
 * every plural label ends in s, no singular one does, and `muscleLabel` is the
 * only source of these strings. A real pluraliser would be a library for a
 * problem that is eighteen rows long.
 */
export const isPluralLabel = (label: string): boolean => label.endsWith("s");

/** "are" for Rear Delts, "is" for Chest. */
export const agrees = (label: string): string => (isPluralLabel(label) ? "are" : "is");

/** "them" for Rear Delts, "it" for Chest. */
export const refersTo = (label: string): string => (isPluralLabel(label) ? "them" : "it");

/** Always signed. "0.4 lb/wk" is ambiguous in the one direction that matters. */
export const signed = (n: number, digits = 0): string =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}`;

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ------------------------------------------------------------------ windows

/** The last `days` calendar days of history, inclusive of `today`. */
export function withinDays(days: HistoryDay[], today: string, window: number): HistoryDay[] {
  const from = shiftIso(today, -(window - 1));
  return days.filter((d) => d.date >= from && d.date <= today);
}

/** Days with at least one working set. The verdict's "is there enough data". */
export const liftDaysIn = (days: HistoryDay[], today: string, window: number): number =>
  withinDays(days, today, window).filter((d) => d.hardSets > 0).length;

/** Days with any intake logged. `estimateTdee`'s other floor. */
export const intakeDaysIn = (days: HistoryDay[], today: string, window: number): number =>
  withinDays(days, today, window).filter((d) => d.kcal !== null && d.kcal > 0).length;

/**
 * A trailing mean over a calendar window, with gaps left as gaps.
 *
 * Iterates every date from the first to the last row in `days`, so a week of
 * not logging is a week of `null` rather than a week that silently never
 * existed. Days with no intake are excluded from the mean rather than counted
 * as zero — a skipped log is not a fast, and treating it as one would drag the
 * line down exactly when the owner was least likely to notice.
 */
export function rollingMean(
  days: HistoryDay[],
  window: number,
  minDays = MIN_INTAKE_DAYS_FOR_MEAN,
): { date: string; mean: number | null }[] {
  if (days.length === 0) return [];

  const kcal = new Map<string, number>();
  for (const d of days) if (d.kcal !== null && d.kcal > 0) kcal.set(d.date, d.kcal);

  const out: { date: string; mean: number | null }[] = [];
  const last = days[days.length - 1].date;
  for (let date = days[0].date; date <= last; date = shiftIso(date, 1)) {
    let sum = 0;
    let n = 0;
    for (let back = 0; back < window; back += 1) {
      const value = kcal.get(shiftIso(date, -back));
      if (value !== undefined) {
        sum += value;
        n += 1;
      }
    }
    out.push({ date, mean: n >= minDays ? Math.round(sum / n) : null });
  }
  return out;
}

export interface Streak {
  count: number;
  /** The most recent weigh-in's date, or null if there has never been one. */
  through: string | null;
}

/**
 * Consecutive calendar days with a weigh-in, counted back from the most recent.
 *
 * One missed day breaks it. There is no forgiveness window and there will not
 * be one: a streak that cannot break is not a measurement, and the only reason
 * this figure is on the screen is that `MIN_WEIGH_INS = 8` gates the
 * maintenance number the owner can see three cards up.
 *
 * It is counted back from the last weigh-in rather than from `today` so that a
 * day in progress does not read as a broken streak at 9am.
 */
export function weighInStreak(days: HistoryDay[]): Streak {
  const dates = days.filter((d) => d.weightLb !== null).map((d) => d.date).sort();
  if (dates.length === 0) return { count: 0, through: null };

  const through = dates[dates.length - 1];
  const seen = new Set(dates);
  let count = 0;
  for (let date = through; seen.has(date); date = shiftIso(date, -1)) count += 1;
  return { count, through };
}

// ------------------------------------------------------- block 2: trajectory

export interface WeightPanel {
  /** Day numbers, so eight days between weigh-ins draws as eight days. */
  xs: number[];
  /** Whole lb, as the payload delivers them. */
  values: number[];
  domainX: [number, number];
  domainY: [number, number];
  /** The OLS fit's two endpoints. Null when the regression is undefined. */
  fit: { xs: [number, number]; values: [number, number] } | null;
  firstLabel: string;
  lastLabel: string;
}

export interface IntakePanel {
  xs: number[];
  values: number[];
  domainX: [number, number];
  domainY: [number, number];
  /** Measured maintenance, when there is one. */
  reference: number | null;
  referenceLabel: string | null;
}

export type Maintenance =
  | { kind: "ok"; value: string; hint: string }
  | { kind: "calibrating"; note: string };

export interface Trajectory {
  /** "−0.4" / "+0.2" lb per week, or null when there is no slope to report. */
  trendLabel: string | null;
  maintenance: Maintenance;
  weight: WeightPanel | null;
  /** Shown instead of the weight panel when there is nothing to draw. */
  weightNote: string | null;
  intake: IntakePanel | null;
  xLabels: { left: string; right: string };
}

/**
 * Bodyweight and intake over 28 days, as two stacked panels.
 *
 * Explicitly NOT a dual-axis chart. Pounds and kilocalories on one pair of axes
 * is the most common charting mistake there is — the crossing point is an
 * artefact of the two scales and reads as a finding. Two panels cost 20pt more
 * and lie about nothing.
 *
 * The fitted line is drawn from `weightTrend()`, the same function behind the
 * maintenance figure printed above it, so the shape on screen and the number
 * cannot disagree. It is fed pounds rather than kilograms, which is sound
 * because ordinary least squares is scale-equivariant: the fitted values come
 * back in whatever unit went in, and the panel is a pound panel.
 */
export function trajectory(b: Bootstrap): Trajectory {
  const window = withinDays(b.history.days, b.today, TRAJECTORY_DAYS);
  const windowStart = shiftIso(b.today, -(TRAJECTORY_DAYS - 1));

  /*
   * The x domain starts at the earliest day that actually has data, not at the
   * nominal window start. An account three days old would otherwise draw its
   * three points squashed against the right edge of a mostly empty chart, which
   * reads as "nothing is happening" rather than as "this just started".
   */
  const firstDate = window.length > 0 ? window[0].date : windowStart;
  const domainX: [number, number] = [dayNumber(firstDate), dayNumber(b.today)];

  const weighIns = window.filter((d) => d.weightLb !== null);
  const fit = weightTrend(
    weighIns.map((d) => ({ localDate: d.date, weightKg: d.weightLb as number })),
  );

  let weight: WeightPanel | null = null;
  let weightNote: string | null = null;

  if (weighIns.length < MIN_WEIGH_INS_FOR_TREND) {
    weightNote = `Two weigh-ins and this draws itself. You have ${weighIns.length}.`;
  } else {
    const xs = weighIns.map((d) => dayNumber(d.date));
    const values = weighIns.map((d) => d.weightLb as number);

    /*
     * The fit is drawn across its own support — first weigh-in to last — rather
     * than across the whole x domain. Extending a 5-day regression back over 23
     * days with no data on them would be an extrapolation drawn in the same
     * 2pt accent as the measurement, which is the one thing a trend line on a
     * body-weight chart must not do.
     */
    const fitEnds = fit
      ? {
          xs: [xs[0], xs[xs.length - 1]] as [number, number],
          values: [
            fitAt(fit.slopeKgPerDay, fit.currentKg, xs[xs.length - 1], xs[0]),
            fit.currentKg,
          ] as [number, number],
        }
      : null;

    const all = fitEnds ? [...values, ...fitEnds.values] : values;
    weight = {
      xs,
      values,
      domainX,
      // ±1 lb, so a two-pound swing over a month does not render as a cliff.
      domainY: [Math.min(...all) - 1, Math.max(...all) + 1],
      fit: fitEnds,
      firstLabel: String(values[0]),
      lastLabel: String(values[values.length - 1]),
    };
  }

  const intakeDays = window.filter((d) => d.kcal !== null && d.kcal > 0).length;
  const reference = b.tdee.status === "ok" ? b.tdee.tdee : null;
  let intake: IntakePanel | null = null;

  if (intakeDays >= MIN_INTAKE_DAYS_FOR_MEAN) {
    const series = rollingMean(window, INTAKE_MEAN_DAYS)
      .filter((p): p is { date: string; mean: number } => p.mean !== null);

    if (series.length > 0) {
      const values = series.map((p) => p.mean);
      const bounds = reference === null ? values : [...values, reference];
      intake = {
        xs: series.map((p) => dayNumber(p.date)),
        values,
        domainX,
        domainY: [Math.min(...bounds) - 150, Math.max(...bounds) + 150],
        reference,
        referenceLabel: reference === null ? null : `MAINT ${reference}`,
      };
    }
  }

  /*
   * The trend figure prefers the server's TDEE regression, which is the number
   * the rest of the app is built on. Below the weigh-in floor there is no
   * `trendKgPerWeek` at all, and the on-device fit over the same window is the
   * honest stand-in — same function, fewer points, and the card says so in the
   * maintenance column right beside it.
   */
  const trendLbPerWeek = b.tdee.status === "ok"
    ? kgToLb(b.tdee.trendKgPerWeek)
    : fit
      ? fit.slopeKgPerDay * 7
      : null;

  return {
    trendLabel: trendLbPerWeek === null ? null : `${signed(trendLbPerWeek, 1)} lb/wk`,
    maintenance: b.tdee.status === "ok"
      ? {
          kind: "ok",
          value: String(b.tdee.tdee),
          hint: `±${b.tdee.marginKcal} · ${plural(b.tdee.weighIns, "weigh-in")}`,
        }
      : {
          kind: "calibrating",
          note: `${b.tdee.weighIns} of ${b.tdee.needed} weigh-ins. `
            + "Keep going and maintenance appears here.",
        },
    weight,
    weightNote,
    intake,
    xLabels: { left: formatShortDate(firstDate), right: "TODAY" },
  };
}

/** The fitted value at `x`, given the fit's slope and its value at `atX`. */
const fitAt = (slope: number, valueAtX: number, atX: number, x: number): number =>
  valueAtX + slope * (x - atX);

// ------------------------------------------------------------ block 3: goals

export interface GoalGap {
  text: string;
  tone: "good" | "ink" | "muted";
}

export interface GoalRow {
  key: string;
  /** The owner's own sentence, verbatim. Never rewritten. */
  sentence: string;
  gap: GoalGap;
  /** "6w" and whether it is tight. Null when the sentence names no month. */
  deadline: { label: string; tone: "warn" | "muted" } | null;
}

export interface GoalsBlock {
  rows: GoalRow[];
  /** Sentences nothing matched. Shown verbatim under their own label. */
  rest: string[];
  /** Set when there is prose but no measurable target in it. */
  note: string | null;
  /** Set when `goalsText` is blank. */
  empty: string | null;
}

/** Weeks left before a deadline is tight enough to colour. */
const DEADLINE_WARN_WEEKS = 4;

/**
 * The gap between a claim and the measurement.
 *
 * A missing measurement is always words — "not enough data", "never logged" —
 * and never a zero or a dash. A dash beside a goal reads as "on target", and
 * that is the one wrong answer this card can give.
 */
export function gapFor(claim: GoalClaim, b: Bootstrap): GoalGap {
  switch (claim.kind) {
    case "bodyweight": {
      const now = currentWeightLb(b);
      if (now === null) return { text: "not enough data", tone: "muted" };

      const delta = claim.targetLb - now;
      const met = Math.abs(delta) < 1;
      const parts = [
        `${Math.round(now)} → ${claim.targetLb}`,
        `${signed(delta)} lb to go`,
      ];

      /*
       * The projection only appears when the trend is pointing at the target.
       * "12 wk at this rate" while gaining away from a cut target would be
       * arithmetically true and useless, and the owner would read the number
       * before reading the sign.
       */
      if (b.tdee.status === "ok" && !met) {
        const perWeek = kgToLb(b.tdee.trendKgPerWeek);
        if (perWeek !== 0 && Math.sign(perWeek) === Math.sign(delta)) {
          parts.push(`${Math.ceil(Math.abs(delta / perWeek))} wk at this rate`);
        }
      }

      return { text: parts.join(" · "), tone: met ? "good" : "ink" };
    }

    case "lift": {
      const now = bestE1rmLbFor(claim.exerciseId, b);
      if (now === null) return { text: "never logged", tone: "muted" };

      const delta = claim.targetLb - now;
      return {
        text: `e1RM ${Math.round(now)} → ${claim.targetLb} · ${signed(delta)} lb`,
        tone: delta <= 0 ? "good" : "ink",
      };
    }

    case "run_distance": {
      const longestM = Math.max(0, ...b.runs.map((r) => r.distanceM ?? 0));
      if (longestM <= 0) return { text: "not enough data", tone: "muted" };

      const longest = round1(miles(longestM));
      return {
        text: `longest ${longest.toFixed(1)} → ${claim.distanceMi.toFixed(1)} mi`,
        tone: longest >= claim.distanceMi ? "good" : "ink",
      };
    }

    case "run_time": {
      const pace = averagePaceSecPerMile(b.runs);
      if (pace === null) return { text: "not enough data", tone: "muted" };

      const projected = pace * claim.distanceMi;
      return {
        text: `at your pace: ${formatDuration(projected)} → ${formatDuration(claim.targetSec)} target`,
        tone: projected <= claim.targetSec ? "good" : "ink",
      };
    }
  }
}

/**
 * Where the scale is now.
 *
 * The regression's fitted value is preferred over the last raw reading because
 * a single morning is ±2 lb of water and the owner would read a one-day spike
 * as progress. Below the weigh-in floor there is no fit, and the raw reading is
 * all there is.
 */
export function currentWeightLb(b: Bootstrap): number | null {
  if (b.tdee.status === "ok") return kgToLb(b.tdee.currentKg);
  const weighed = b.history.days.filter((d) => d.weightLb !== null);
  return weighed.length > 0 ? (weighed[weighed.length - 1].weightLb as number) : null;
}

/** The best e1RM on record for one lift, from either source that carries it. */
export function bestE1rmLbFor(exerciseId: string, b: Bootstrap): number | null {
  const series = b.history.mainLifts.find((l) => l.exerciseId === exerciseId);
  const candidates = series ? series.points.map((p) => p.e1rmLb) : [];

  /*
   * `lastSets` is consulted as well as the 8-week series because the two cover
   * different ground: a lift trained once four months ago is in `lastSets` and
   * not in `mainLifts` at all, and a goal against it should still show a figure
   * rather than claiming the lift was never logged.
   */
  const last = b.lastSets[exerciseId];
  if (last && last.bestE1rmLb !== null) candidates.push(last.bestE1rmLb);

  return candidates.length > 0 ? Math.max(...candidates) : null;
}

export function goalsBlock(b: Bootstrap): GoalsBlock {
  if (b.goalsText.trim() === "") {
    return {
      rows: [],
      rest: [],
      note: null,
      empty: "Nothing written down yet. What you're actually training for goes on the You screen.",
    };
  }

  const { claims, rest } = extractGoalClaims(b.goalsText, b.catalogue, b.today);

  const rows = claims.map((claim, i) => {
    const gap = gapFor(claim, b);
    return {
      key: `${claim.kind}-${i}`,
      sentence: claim.sentence,
      gap,
      deadline: deadlineFor(claim.byDate, b.today, gap.tone === "good"),
    };
  });

  return {
    rows,
    rest,
    note: rows.length === 0
      ? "No measurable target in this yet. A number and a month — \"bench 225 by March\" — "
        + "and this card tracks it."
      : null,
    empty: null,
  };
}

function deadlineFor(
  byDate: string | null,
  today: string,
  met: boolean,
): { label: string; tone: "warn" | "muted" } | null {
  if (byDate === null) return null;
  const weeks = Math.max(0, Math.floor((dayNumber(byDate) - dayNumber(today)) / 7));
  return {
    label: `${weeks}w`,
    tone: weeks < DEADLINE_WARN_WEEKS && !met ? "warn" : "muted",
  };
}

// --------------------------------------------------------- block 4: strength

export interface StrengthRow {
  exerciseId: string;
  name: string;
  /** e1RM in lb, ascending by session. */
  values: number[];
  /** `last − first`, in lb. Zero for a one-session lift. */
  delta: number;
  /** Null for a one-session lift: there is no delta, and a "0" would imply flat. */
  deltaLabel: string | null;
  tone: "good" | "muted" | "warn";
  /** One logged session. Draws a point and says so — never a two-point line. */
  single: boolean;
}

export function strengthRows(b: Bootstrap): StrengthRow[] {
  return b.history.mainLifts
    .filter((lift) => lift.points.length > 0)
    .map((lift) => {
      const values = lift.points.map((p) => Math.round(p.e1rmLb));
      const single = values.length === 1;
      const delta = single ? 0 : values[values.length - 1] - values[0];
      return {
        exerciseId: lift.exerciseId,
        name: lift.name,
        values,
        delta,
        deltaLabel: single ? null : `${signed(delta)} lb`,
        tone: delta > 0 ? "good" : delta < 0 ? "warn" : "muted",
        single,
      };
    });
}

// ------------------------------------------------------------- block 5: load

export interface LoadBlock {
  /** Whole working sets per ISO week, ascending, oldest first. */
  hardSets: number[];
  /** Miles per ISO week over the same buckets. */
  runMiles: number[];
  median: number;
  /**
   * Null when the median is zero. A dashed reference line sitting on the
   * baseline says nothing and overlaps the zero-week ticks — an account three
   * weeks old has a median of 0 and does not need to be told.
   */
  medianLabel: string | null;
  /** The current, incomplete week. Drawn at 70% so it cannot read as complete. */
  partialIndex: number;
  weekStarts: string[];
  xLabels: { left: string; right: string };
  /** Nothing in eight weeks: one line, no chart. */
  empty: boolean;
}

/**
 * Eight Monday-start weeks of lifting load and run mileage.
 *
 * `hardSets` is whole working sets per day, summed — NOT the muscle-weighted
 * fractions `hardSetsByMuscle()` produces, which are larger because one bench
 * set counts 1.0 to chest and 0.5 to triceps. Those two numbers differ and the
 * card's label says which this is.
 *
 * Run miles get their own panel rather than a second axis on the first one.
 * Same rule as the trajectory card: a second measure is a second panel.
 */
export function loadBlock(b: Bootstrap): LoadBlock {
  const currentWeek = weekStartOf(b.today);
  const weekStarts = Array.from(
    { length: LOAD_WEEKS },
    (_, i) => shiftIso(currentWeek, -7 * (LOAD_WEEKS - 1 - i)),
  );

  const perWeek = new Map<string, number>();
  for (const day of b.history.days) {
    if (day.hardSets <= 0) continue;
    const start = weekStartOf(day.date);
    perWeek.set(start, (perWeek.get(start) ?? 0) + day.hardSets);
  }

  const hardSets = weekStarts.map((w) => perWeek.get(w) ?? 0);
  const runMiles = weekStarts.map((w) => weeklyRunStats(b.runs, w).distanceMi);
  const med = median(hardSets);

  return {
    hardSets,
    runMiles,
    median: med,
    medianLabel: med > 0 ? `MED ${Math.round(med)}` : null,
    partialIndex: LOAD_WEEKS - 1,
    weekStarts,
    xLabels: { left: formatShortDate(weekStarts[0]), right: "THIS WK" },
    empty: hardSets.every((n) => n === 0) && runMiles.every((n) => n === 0),
  };
}

// ------------------------------------------------------ block 6: consistency

export interface ConsistencyStat {
  label: string;
  value: string;
  hint?: string;
}

export interface ConsistencyBlock {
  stats: [ConsistencyStat, ConsistencyStat, ConsistencyStat];
  note: string;
}

/**
 * Three figures, chosen by what they unlock rather than by what they reward.
 *
 * Each one gates a computation the owner can see elsewhere on this screen:
 * `MIN_WEIGH_INS = 8` gates the maintenance figure, `estimateTdee` needs seven
 * intake days, and the verdict sentence needs five lift days. That is the whole
 * selection rule.
 *
 * What is deliberately absent, and why:
 *
 *  - No consecutive-lift-day streak. Training seven days a week is not the
 *    goal, and a counter that rewarded it would argue with the verdict sentence
 *    directly above it — which exists partly to say "take today off".
 *  - No "perfect day" or target-hit streak. It rewards under-logging the evening
 *    meal, which corrupts the one input adaptive TDEE cannot survive without.
 *  - No app-open or session-started streak. That measures the app, not the
 *    person.
 *
 * This card always renders. `0 day streak` is information, and a zero that is
 * true is better than a card that hides when the news is bad.
 */
export function consistencyBlock(b: Bootstrap): ConsistencyBlock {
  const streak = weighInStreak(b.history.days);
  const intake = intakeDaysIn(b.history.days, b.today, CONSISTENCY_WINDOW_DAYS);
  const lifts = liftDaysIn(b.history.days, b.today, CONSISTENCY_WINDOW_DAYS);

  return {
    stats: [
      {
        label: "WEIGH-INS",
        value: `${streak.count} day streak`,
        /*
         * The figure is not reduced when the last weigh-in was not today — the
         * day is not over. The hint says where the count stops instead, which
         * is the only honest way to show a streak before breakfast.
         */
        hint: streak.through === null || streak.through === b.today
          ? undefined
          : `THROUGH ${streak.through === shiftIso(b.today, -1)
            ? "YESTERDAY"
            : formatShortDate(streak.through).toUpperCase()}`,
      },
      {
        label: "INTAKE",
        value: `${intake}/${CONSISTENCY_WINDOW_DAYS} days`,
        hint: `TDEE NEEDS ${TDEE_INTAKE_DAYS_NEEDED}`,
      },
      {
        label: "LIFTS",
        value: `${lifts} in ${CONSISTENCY_WINDOW_DAYS}d`,
        hint: `${(lifts / (CONSISTENCY_WINDOW_DAYS / 7)).toFixed(1)}/wk`,
      },
    ],
    note: "Streak counts days you weighed in. Nothing else — not app opens, "
      + "not hitting a target.",
  };
}

// ------------------------------------------------------------------ the model

export interface TodayModel {
  /** "Saturday, October 25" */
  dateLine: string;
  sessionInProgress: boolean;
  trajectory: Trajectory;
  goals: GoalsBlock;
  strength: StrengthRow[];
  load: LoadBlock;
  consistency: ConsistencyBlock;
}

/**
 * Everything the screen draws except the verdict sentence.
 *
 * `verdict()` is called separately by the screen rather than folded in here,
 * which looks like an inconsistency and is not: `verdict.ts` imports the date
 * helpers from this module, so calling it from here would make the two modules
 * mutually dependent. An import cycle that happens to work today because of
 * evaluation order is not a thing to leave in a file nobody will read again.
 */
export function buildTodayModel(b: Bootstrap): TodayModel {
  return {
    dateLine: formatLongDate(b.today),
    sessionInProgress: b.activeWorkout !== null,
    trajectory: trajectory(b),
    goals: goalsBlock(b),
    strength: strengthRows(b),
    load: loadBlock(b),
    consistency: consistencyBlock(b),
  };
}

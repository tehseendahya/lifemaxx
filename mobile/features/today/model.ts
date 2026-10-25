/*
 * The imports below are relative rather than `@/lib/...`, which is the only
 * place in this feature that deviates from the alias convention. The reason is
 * that `mobile/vitest.config.ts` runs in a plain node environment with no path
 * alias configured (see the existing `lib/*.test.ts`, which are all relative
 * for the same reason), and the whole point of keeping this module free of
 * `react-native` imports is that it can be unit-tested. A module that needs
 * build configuration before it can be tested does not get tested.
 */
import { summarizeRunningWeek, weekStartOf, formatPace } from "../../lib/shared/running";
import { WEEKLY_SET_TARGET } from "../../lib/shared/muscles";
import { kgToLb } from "../../lib/shared/units";
import type { Bootstrap } from "../../lib/types";

/**
 * `bootstrap` → everything the Today screen renders, as plain data.
 *
 * Split out from the component for one reason: this is the part that can be
 * tested. There is no simulator in this container, so the five states that
 * actually crash a dashboard — no runs, no meals, no calorie target, not enough
 * weigh-ins, an interference hit — are covered here as assertions on strings
 * and numbers rather than as something someone has to go and look at.
 *
 * It imports nothing from `react-native`, which is also what keeps it runnable
 * under the node-environment vitest config.
 *
 * Every figure below is either copied straight out of the payload or produced
 * by a function in `@/lib/shared/*`. Nothing here recomputes pace, weekly
 * mileage, interference, set debt or maintenance — those all already exist in
 * the domain layer the web app uses, and a second implementation is how the two
 * clients start disagreeing about a number the user can see on both.
 */

export interface MacroRow {
  label: string;
  value: number;
  target: number | null;
}

export interface MuscleRow {
  muscle: string;
  label: string;
  /** "7.5/10 sets · 5d ago" */
  figure: string;
}

export interface RunningCard {
  distanceMi: number;
  /** "mi · 8:42/mi · 3 runs" — the muted tail beside the big figure. */
  detail: string;
  /** Present only when hard running landed on a leg day. Takes precedence over `note`. */
  warning: string | null;
  /** Last week's mileage, or the first-week line. Null when `warning` is showing. */
  note: string | null;
}

export type MaintenanceCard =
  | { status: "ok"; tdee: string; hint: string; trend: string }
  | { status: "insufficient"; note: string };

export interface TodayModel {
  /** "Saturday, October 25" */
  dateLine: string;
  sessionInProgress: boolean;
  fuel: {
    kcal: number;
    /** "of 2600 kcal", or the still-calibrating line when there is no target. */
    targetLine: string;
    macros: [MacroRow, MacroRow, MacroRow];
    /** "Log your first meal →" / "3 meals logged →" */
    mealLine: string;
  };
  trainNext: {
    summary: string;
    rows: MuscleRow[];
    /** Set when `rows` is empty, so the card never renders as a blank block. */
    emptyNote: string | null;
    liftLine: string;
  };
  /** Null when there are no runs at all: the card disappears rather than sitting empty forever. */
  running: RunningCard | null;
  maintenance: MaintenanceCard;
}

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * "Saturday, October 25" from a `YYYY-MM-DD`.
 *
 * Deliberately NOT `new Date().toLocaleDateString(...)`, which is what the web
 * page does. That reads the *device* clock, and `bootstrap.today` is the date in
 * the user's profile timezone — so on a phone that has travelled, the header
 * would name a different day than the data underneath it. Formatting the
 * server's own date string fixes that, is pure, and does not depend on which
 * ICU build Hermes was compiled with.
 */
export function formatLongDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function buildTodayModel(b: Bootstrap): TodayModel {
  const running = buildRunningCard(b);

  return {
    dateLine: formatLongDate(b.today),
    sessionInProgress: b.activeWorkout !== null,
    fuel: {
      kcal: Math.round(b.totals.kcal),
      targetLine: b.target.kcal
        ? `of ${b.target.kcal} kcal`
        : "kcal — no target yet, still calibrating",
      macros: [
        // `target.proteinG` is never null: the server falls back to
        // `defaultProteinTarget()`, because protein is the one figure that is
        // already correct before calibration has produced a calorie target.
        { label: "Protein", value: b.totals.proteinG, target: b.target.proteinG },
        { label: "Carbs", value: b.totals.carbsG, target: b.target.carbsG },
        { label: "Fat", value: b.totals.fatG, target: b.target.fatG },
      ],
      mealLine: b.mealCount === 0
        ? "Log your first meal →"
        : `${plural(b.mealCount, "meal")} logged →`,
    },
    trainNext: buildTrainNext(b),
    running,
    maintenance: buildMaintenance(b),
  };
}

/**
 * What replaces a split.
 *
 * `volume.summary` is used rather than calling `summarize()` here, and that is
 * not laziness: `volume.ranked` is a five-field projection of the domain's
 * `Recommendation`, with `status`, `reason` and `weakShare` dropped on the way
 * over the wire. `summarize()` reads `reason` when exactly one muscle is owed
 * sets, so calling it on the DTO would not typecheck and would throw on a day
 * with one muscle behind. `volume.summary` IS that function's output, computed
 * server-side from the complete objects — which also means the sentence on the
 * phone is the same sentence the web app shows, rather than one recomputed from
 * a lossy copy.
 */
function buildTrainNext(b: Bootstrap): TodayModel["trainNext"] {
  const due = b.volume.ranked.filter((r) => r.score > 0.2).slice(0, 4);

  return {
    summary: b.volume.summary,
    rows: due.map((r) => ({
      muscle: r.muscle,
      label: r.label,
      figure: `${round1(r.setsLast7d)}/${WEEKLY_SET_TARGET.min} sets${
        r.daysSinceTrained !== null ? ` · ${r.daysSinceTrained}d ago` : " · never"
      }`,
    })),
    emptyNote: due.length === 0 ? "Nothing is behind. Train whatever you feel like." : null,
    liftLine: b.activeWorkout ? "Resume session →" : "Start a lift →",
  };
}

/**
 * The week's running, from the raw runs.
 *
 * `runs` and `lowerBodyLiftDates` arrive unprocessed on purpose, so this runs
 * the same `summarizeRunningWeek()` that `src/app/page.tsx` runs server-side.
 * The interference warning displaces last week's mileage rather than appearing
 * alongside it: hard running stacked on a leg day is the one thing this app can
 * tell the user that a calorie app cannot, and it does not compete for the line
 * with a number they can get anywhere.
 */
function buildRunningCard(b: Bootstrap): RunningCard | null {
  if (b.runs.length === 0) return null;

  const week = summarizeRunningWeek(b.runs, b.lowerBodyLiftDates, weekStartOf(b.today));
  const hits = week.interference.length;

  return {
    distanceMi: week.thisWeek.distanceMi,
    detail: `mi · ${formatPace(week.thisWeek.avgPaceSecPerMile)}/mi · ${plural(week.thisWeek.runs, "run")}`,
    warning: hits > 0
      ? `Hard running stacked on a leg day${hits > 1 ? ` ${hits} times` : ""} this week.`
      : null,
    note: hits > 0
      ? null
      : week.lastWeek.distanceMi > 0
        ? `${week.lastWeek.distanceMi} mi last week.`
        : "First week of logged mileage.",
  };
}

/**
 * Measured maintenance, or an admission that it is not measurable yet.
 *
 * Below the weigh-in floor there is deliberately no number — not a greyed-out
 * one, not an estimate from height and weight. The whole point of an adaptive
 * TDEE is that it is derived from this person's own data, and a figure invented
 * before there is enough of that is worse than a blank, because it will be
 * believed and then quietly contradicted a fortnight later.
 */
function buildMaintenance(b: Bootstrap): MaintenanceCard {
  if (b.tdee.status !== "ok") {
    return {
      status: "insufficient",
      note: `Not enough weigh-ins for a reliable number — ${b.tdee.weighIns} of ${b.tdee.needed}. `
        + "Weigh in most mornings and this fills itself in.",
    };
  }

  const lbPerWeek = kgToLb(b.tdee.trendKgPerWeek);
  return {
    status: "ok",
    tdee: `${b.tdee.tdee}`,
    hint: `±${b.tdee.marginKcal} kcal · from ${plural(b.tdee.weighIns, "weigh-in")}`,
    // Signed on purpose: "0.4 lb/wk" is ambiguous in the one direction it
    // matters, and the sign is the entire content of the figure.
    trend: `${lbPerWeek > 0 ? "+" : ""}${lbPerWeek.toFixed(1)} lb/wk`,
  };
}

/*
 * The imports below are relative rather than `@/lib/...`, which is the only
 * place in this feature that deviates from the alias convention. The reason is
 * that `mobile/vitest.config.ts` runs in a plain node environment with no path
 * alias configured (see the existing `lib/*.test.ts`, which are all relative
 * for the same reason), and the whole point of keeping this module free of
 * `react-native` imports is that it can be unit-tested. A module that needs
 * build configuration before it can be tested does not get tested.
 */
import {
  MIN_RUNS_FOR_TREND, averagePaceSecPerMile, classifyRun, feet, formatPace, miles,
  paceSecPerMile, summarizeRunningWeek, weeklyRunStats, weekStartOf,
} from "../../lib/shared/running";
import type { InterferenceHit, PaceTrend, RunEffort } from "../../lib/shared/running";
import type { Bootstrap, RunDto } from "../../lib/types";

/**
 * `bootstrap.runs` → the Runs screen, as plain data.
 *
 * Every number on this screen comes out of `@/lib/shared/running`, which is the
 * same module `src/app/runs/page.tsx` calls server-side. Weekly mileage, pace,
 * the least-squares pace trend and the interference detection are all already
 * written and tested there; re-deriving any of them here would give the phone
 * and the laptop two different answers to "how far did I run this week", which
 * is the one thing a shared domain layer exists to make impossible.
 *
 * Two things the web page has are deliberately absent. The stored weekly
 * verdicts (`getWeeklyRunningSummary`, `getRecentWeeklyRunningSummaries`, both
 * written by the Sunday cron) are not in the `bootstrap` payload, so the
 * "earlier weeks" block is computed mileage rather than prose — see
 * `recentWeeks`. And tapping a run does nothing: there is no run-detail
 * endpoint, and navigation that dead-ends is worse than none.
 */

export interface StatRow {
  label: string;
  value: string;
  hint: string;
}

/** The sentence is split so only the figure carries the colour, as on the web. */
export interface TrendNote {
  lead: string;
  figure: string | null;
  tail: string;
  tone: "good" | "warn" | "muted";
}

export interface InterferenceCard {
  headline: string;
  rows: { key: string; text: string }[];
  footnote: string;
}

export interface RunRow {
  id: string;
  name: string;
  date: string;
  /** "6.2 mi" · "8:42/mi" · "52 min" · "612 ft" · "156 bpm" — only what the run actually has. */
  figures: string[];
  effort: RunEffort;
  verdict: string | null;
}

export interface WeekRow {
  weekStart: string;
  distanceMi: number;
  avgPace: string;
  runs: number;
}

export interface RunsModel {
  /** Null when there is nothing logged, so the header does not claim 0 miles. */
  subtitle: string | null;
  isEmpty: boolean;
  week: StatRow[];
  trend: TrendNote;
  /** Null when no hard or long run landed next to a leg day this week. */
  interference: InterferenceCard | null;
  runs: RunRow[];
  history: WeekRow[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** How many weeks the "earlier weeks" block covers. `getRuns` returns a 56-day window. */
export const HISTORY_WEEKS = 8;

export function buildRunsModel(b: Bootstrap): RunsModel {
  const runs = b.runs;
  const week = summarizeRunningWeek(runs, b.lowerBodyLiftDates, weekStartOf(b.today));
  const baseline = averagePaceSecPerMile(runs);

  return {
    subtitle: runs.length > 0
      ? `${week.totalMi} miles logged in the last ${HISTORY_WEEKS} weeks`
      : null,
    isEmpty: runs.length === 0,
    week: [
      {
        label: "Miles",
        value: `${week.thisWeek.distanceMi}`,
        hint: `${week.lastWeek.distanceMi} last week`,
      },
      {
        label: "Avg pace",
        value: formatPace(week.thisWeek.avgPaceSecPerMile),
        hint: "min / mi",
      },
      {
        label: "Longest",
        value: `${week.thisWeek.longestRunMi}`,
        hint: plural(week.thisWeek.runs, "run"),
      },
      { label: "Time", value: `${week.thisWeek.durationMin}`, hint: "minutes" },
      { label: "Climb", value: `${week.thisWeek.elevationFt}`, hint: "feet" },
      {
        label: "Hard / long",
        value: `${week.thisWeek.hardOrLongRuns}`,
        hint: "sessions",
      },
    ],
    trend: trendNote(week.trend),
    interference: interferenceCard(week.interference),
    runs: runRows(runs, baseline),
    history: recentWeeks(runs, b.today),
  };
}

/**
 * What the pace is doing, or why that cannot be said yet.
 *
 * `paceTrend` returns a slope from as few as two runs, and `reliable` is what
 * marks the ones worth quoting. A trend drawn through three runs is noise, and
 * printing it anyway would contradict the rule the TDEE card and the coach both
 * follow: say you do not know rather than manufacture confidence.
 */
function trendNote(trend: PaceTrend | null): TrendNote {
  if (!trend) {
    return {
      lead: "Not enough runs yet to say anything about pace.",
      figure: null,
      tail: "",
      tone: "muted",
    };
  }

  if (!trend.reliable) {
    const more = MIN_RUNS_FOR_TREND - trend.runsUsed;
    return {
      lead: `Pace trend needs ${plural(more, "more run")} before it means anything.`,
      figure: null,
      tail: "",
      tone: "muted",
    };
  }

  const seconds = Math.round(Math.abs(trend.secPerMilePerWeek));
  const faster = trend.secPerMilePerWeek < 0;

  return {
    lead: faster ? "Pace trending " : "Pace drifting ",
    figure: `${seconds}s/mi ${faster ? "faster" : "slower"}`,
    tail: ` per week, over ${plural(trend.runsUsed, "run")}.`,
    tone: faster ? "good" : "warn",
  };
}

/**
 * Hard running inside a day of a leg session.
 *
 * Easy runs are excluded by `detectInterference` on purpose — easy mileage next
 * to a squat day is the plan working, not a conflict — so nothing here filters
 * the hits further or adds them back.
 */
function interferenceCard(hits: InterferenceHit[]): InterferenceCard | null {
  if (hits.length === 0) return null;

  return {
    headline: "Hard running landed within a day of a leg session "
      + `${hits.length === 1 ? "once" : `${hits.length} times`} this week.`,
    // The index is in the key because two hard runs on one date against one
    // leg day produce two hits with identical dates and effort.
    rows: hits.map((hit, i) => ({
      key: `${i}-${hit.runDate}-${hit.liftDate}`,
      text: `${hit.effort} run ${hit.runDate} · legs ${hit.liftDate} · ${gapLabel(hit.daysApart)}`,
    })),
    footnote: "Both adaptations blunt when they stack. The half is the dated goal.",
  };
}

/** `daysApart` is lift minus run, and `detectInterference` only emits -1, 0 or 1. */
function gapLabel(daysApart: number): string {
  if (daysApart === 0) return "same day";
  return daysApart > 0 ? "legs next day" : "legs the day before";
}

function runRows(runs: RunDto[], baseline: number | null): RunRow[] {
  // The API returns these newest first, but the screen should not break if that
  // ever changes — and sorting a copy leaves the array the domain functions see
  // untouched, since several of them are order-sensitive only by accident.
  return [...runs]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((run) => {
      const figures = [
        `${round1(miles(run.distanceM ?? 0))} mi`,
        `${formatPace(paceSecPerMile(run.distanceM, run.durationS))}/mi`,
        `${Math.round(run.durationS / 60)} min`,
      ];
      if (run.elevationM) figures.push(`${Math.round(feet(run.elevationM))} ft`);
      if (run.avgHr) figures.push(`${Math.round(run.avgHr)} bpm`);

      return {
        id: run.id,
        name: run.name || "Run",
        date: run.localDate,
        figures,
        effort: classifyRun(run, baseline),
        verdict: run.verdict,
      };
    });
}

/**
 * The Monday-anchored weeks inside the lookback, newest first.
 *
 * An empty week in the MIDDLE is kept: a week with no mileage between two that
 * have some is a rest week or a missed week, and both are worth seeing in a
 * column that is otherwise building. Filtering those out would make a
 * three-week gap read as three consecutive weeks of training.
 *
 * Trailing empty weeks are dropped, which is a different case: they are not
 * rest weeks, they are weeks before this person had any logged runs at all. On
 * a new account that is six of the eight rows, and a block of "0 mi · —"
 * reads as something broken rather than as an account that is three weeks old.
 */
export function recentWeeks(runs: RunDto[], today: string, count = HISTORY_WEEKS): WeekRow[] {
  const cursor = new Date(`${weekStartOf(today)}T00:00:00Z`);
  const rows: WeekRow[] = [];

  for (let i = 0; i < count; i += 1) {
    const weekStart = cursor.toISOString().slice(0, 10);
    const stats = weeklyRunStats(runs, weekStart);
    rows.push({
      weekStart,
      distanceMi: stats.distanceMi,
      avgPace: formatPace(stats.avgPaceSecPerMile),
      runs: stats.runs,
    });
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }

  while (rows.length > 0 && rows[rows.length - 1].runs === 0) rows.pop();
  return rows;
}

import { db, withUser } from "@/db";
import { activities, weeklyRunningSummaries } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getLlm, JSON_SCHEMAS, runVerdictsSchema } from "@/lib/llm";
import { MODELS } from "@/lib/models";
import {
  COACH_VOICE, RUN_VERDICT_SYSTEM, RUNNING_WEEK_SYSTEM, goalsBlock, stableJson,
} from "@/lib/llm/prompts";
import {
  averagePaceSecPerMile, classifyRun, formatPace, miles, paceSecPerMile,
  summarizeRunningWeek, weekStartOf, type Run,
} from "@/lib/domain/running";
import { getRuns, getLowerBodyLiftDates, type StoredRun } from "@/lib/queries";

/**
 * Turning stored runs into something the app actually says out loud.
 *
 * Before this, the Strava pull wrote rows and the coach got them as raw
 * context. Nothing surfaced a run anywhere, which for someone whose stated
 * goal starts "half marathon in the fall" is the wrong thing to leave buried.
 *
 * Two levels, both on the cheap model: a one-line verdict per run, generated
 * nightly right after the sync, and a weekly rollup on Sunday.
 *
 * Model calls here sit outside `withUser()` for the usual reason — the reads
 * and the writes each get their own short scope.
 */

/** How many un-verdicted runs one nightly call will describe. */
const VERDICT_BATCH = 12;

interface RunForPrompt {
  index: number;
  date: string;
  name: string;
  miles: number;
  minutes: number;
  pace_min_mi: string;
  elevation_ft: number;
  avg_hr: number | null;
  effort: string;
  lifted_legs_within_a_day: boolean;
}

function describeRuns(runs: StoredRun[], all: Run[], lowerBodyDates: Set<string>): RunForPrompt[] {
  const baseline = averagePaceSecPerMile(all);
  return runs.map((run, index) => ({
    index,
    date: run.localDate,
    name: run.name,
    miles: Math.round(miles(run.distanceM ?? 0) * 100) / 100,
    minutes: Math.round(run.durationS / 60),
    pace_min_mi: formatPace(paceSecPerMile(run.distanceM, run.durationS)),
    elevation_ft: Math.round((run.elevationM ?? 0) / 0.3048),
    avg_hr: run.avgHr === null ? null : Math.round(run.avgHr),
    effort: classifyRun(run, baseline),
    lifted_legs_within_a_day: [-1, 0, 1].some((offset) => {
      const d = new Date(`${run.localDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + offset);
      return lowerBodyDates.has(d.toISOString().slice(0, 10));
    }),
  }));
}

/**
 * Writes a verdict onto every run that does not have one yet.
 *
 * Batched into a single call: at four runs a week the alternative is four
 * requests a night to say four sentences.
 */
export async function generateRunVerdicts(
  userId: string,
  goalsText: string,
  today: string,
): Promise<number> {
  const { pending, all, lowerBodyDates } = await withUser(userId, async () => {
    const runs = await getRuns(userId, today);
    return {
      pending: runs.filter((r) => r.verdict === null).slice(0, VERDICT_BATCH),
      all: runs,
      lowerBodyDates: new Set(await getLowerBodyLiftDates(userId, today)),
    };
  });

  if (pending.length === 0) return 0;

  const baseline = averagePaceSecPerMile(all);
  const described = describeRuns(pending, all, lowerBodyDates);

  const result = await getLlm().structured({
    model: MODELS.digest,
    messages: [
      { role: "system", content: `${goalsBlock(goalsText)}\n\n${RUN_VERDICT_SYSTEM}` },
      {
        role: "user",
        content:
          `Their recent average pace across runs of 2 miles or more: ${formatPace(baseline)} min/mi.\n\n` +
          `RUNS:\n${stableJson(described)}\n\n` +
          `Return exactly ${described.length} verdicts, one per index.`,
      },
    ],
    schemaName: "run_verdicts",
    jsonSchema: JSON_SCHEMAS.run_verdicts,
    validator: runVerdictsSchema,
    maxTokens: 120 * described.length + 200,
  });

  const generatedAt = new Date();
  let written = 0;

  await withUser(userId, async () => {
    for (const { index, verdict } of result.verdicts) {
      const run = pending[index];
      // A model that returns an index outside the batch has lost track of the
      // list; writing that verdict would attach it to the wrong run.
      if (!run || !verdict.trim()) continue;
      await db.update(activities)
        .set({ verdict: verdict.trim(), verdictGeneratedAt: generatedAt })
        .where(eq(activities.id, run.id));
      written += 1;
    }
  });

  return written;
}

/**
 * The Sunday rollup: mileage week over week, whether the pace is genuinely
 * moving, and where the running load landed on top of the lifting load.
 *
 * Stored rather than recomputed on view, so the week's verdict doesn't quietly
 * change every time the page is opened.
 */
export async function generateWeeklyRunningSummary(
  userId: string,
  goalsText: string,
  today: string,
): Promise<string | null> {
  const weekStart = weekStartOf(today);

  const { runs, lowerBodyDates } = await withUser(userId, async () => ({
    runs: await getRuns(userId, today),
    lowerBodyDates: await getLowerBodyLiftDates(userId, today),
  }));

  const week = summarizeRunningWeek(runs, lowerBodyDates, weekStart);

  // No runs this week and none last week is not a rollup, it's a blank page.
  if (week.thisWeek.runs === 0 && week.lastWeek.runs === 0) return null;

  const stats = {
    this_week: {
      ...week.thisWeek,
      avg_pace_min_mi: formatPace(week.thisWeek.avgPaceSecPerMile),
    },
    last_week: {
      ...week.lastWeek,
      avg_pace_min_mi: formatPace(week.lastWeek.avgPaceSecPerMile),
    },
    pace_trend: week.trend
      ? {
        seconds_per_mile_per_week: Math.round(week.trend.secPerMilePerWeek * 10) / 10,
        runs_used: week.trend.runsUsed,
        // The model is told not to quote a number it has been told not to
        // trust — same rule the coach follows on thin data everywhere else.
        reliable: week.trend.reliable,
      }
      : null,
    hard_running_stacked_on_leg_days: week.interference.map((h) => ({
      run_date: h.runDate, lift_date: h.liftDate, effort: h.effort,
    })),
    total_miles_in_lookback: week.totalMi,
  };

  const summary = await getLlm().text({
    model: MODELS.digest,
    messages: [
      { role: "system", content: `${goalsBlock(goalsText)}\n\n${COACH_VOICE}\n\n${RUNNING_WEEK_SYSTEM}` },
      { role: "user", content: `WEEK OF ${weekStart}:\n${stableJson(stats)}` },
    ],
    maxTokens: 300,
  });

  if (!summary.trim()) return null;

  await withUser(userId, async () => {
    await db.insert(weeklyRunningSummaries)
      .values({ userId, weekStart, stats, summary: summary.trim() })
      .onConflictDoUpdate({
        target: [weeklyRunningSummaries.userId, weeklyRunningSummaries.weekStart],
        set: { stats, summary: summary.trim(), generatedAt: new Date() },
      });
  });

  return summary.trim();
}

/** Clears verdicts so the next nightly run regenerates them. Used by tests. */
export async function clearRunVerdicts(userId: string, ids: string[]) {
  if (ids.length === 0) return;
  await withUser(userId, () => db.update(activities)
    .set({ verdict: null, verdictGeneratedAt: null })
    .where(inArray(activities.id, ids)));
}

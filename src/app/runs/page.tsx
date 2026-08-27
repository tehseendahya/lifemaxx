import { currentUserId } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { withUser } from "@/db";
import {
  getProfile, localDate, getRuns, getLowerBodyLiftDates,
  getWeeklyRunningSummary, getRecentWeeklyRunningSummaries,
} from "@/lib/queries";
import {
  summarizeRunningWeek, weekStartOf, formatPace, paceSecPerMile, miles, feet,
  classifyRun, averagePaceSecPerMile,
} from "@/lib/domain/running";
import { Screen, Card, Label, Empty, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Running, on its own screen.
 *
 * The goal text starts "half marathon in the fall", so the runs get a tab
 * rather than a line in the coach's context window. Everything here is
 * computed from the stored activities except the two verdicts, which the
 * nightly and Sunday crons write.
 */
export default async function Runs() {
  const userId = await currentUserId();
  if (!userId) redirect("/login");

  const profile = await withUser(userId, () => getProfile(userId));
  const tz = profile?.tz ?? "America/New_York";
  const today = localDate(tz);

  const { runs, lowerBodyDates, weekSummary, history } = await withUser(userId, async () => ({
    runs: await getRuns(userId, today),
    lowerBodyDates: await getLowerBodyLiftDates(userId, today),
    weekSummary: await getWeeklyRunningSummary(userId, today),
    history: await getRecentWeeklyRunningSummaries(userId, 6),
  }));

  const week = summarizeRunningWeek(runs, lowerBodyDates, weekStartOf(today));
  const baseline = averagePaceSecPerMile(runs);
  const trend = week.trend;

  return (
    <Screen
      title="Running"
      subtitle={runs.length > 0 ? `${week.totalMi} miles logged in the last 8 weeks` : undefined}
    >
      {runs.length === 0 ? (
        <Empty>
          No runs yet. Connect Strava in Settings and they arrive on the nightly pull.
        </Empty>
      ) : (
        <>
          <Card className="mb-4">
            <Label>This week</Label>
            <div className="grid grid-cols-3 gap-3">
              <Stat
                label="Miles"
                value={week.thisWeek.distanceMi}
                hint={`${week.lastWeek.distanceMi} last week`}
              />
              <Stat
                label="Avg pace"
                value={formatPace(week.thisWeek.avgPaceSecPerMile)}
                hint="min / mi"
              />
              <Stat
                label="Longest"
                value={week.thisWeek.longestRunMi}
                hint={`${week.thisWeek.runs} run${week.thisWeek.runs === 1 ? "" : "s"}`}
              />
            </div>

            {/*
              A trend computed from four runs is noise, and saying so is the
              same rule the TDEE screen and the coach follow. Quoting a number
              here that the model has been told not to trust would be worse
              than showing nothing.
            */}
            <p className="mt-3 border-t border-line pt-3 text-sm text-muted">
              {!trend ? (
                "Not enough runs yet to say anything about pace."
              ) : !trend.reliable ? (
                `Pace trend needs ${5 - trend.runsUsed} more run${5 - trend.runsUsed === 1 ? "" : "s"} before it means anything.`
              ) : trend.secPerMilePerWeek < 0 ? (
                <>Pace trending <span className="text-good">{Math.abs(Math.round(trend.secPerMilePerWeek))}s/mi faster</span> per week, over {trend.runsUsed} runs.</>
              ) : (
                <>Pace drifting <span className="text-warn">{Math.round(trend.secPerMilePerWeek)}s/mi slower</span> per week, over {trend.runsUsed} runs.</>
              )}
            </p>
          </Card>

          {weekSummary && (
            <Card className="mb-4">
              <Label>The week&apos;s verdict</Label>
              <p className="text-sm">{weekSummary.summary}</p>
            </Card>
          )}

          {week.interference.length > 0 && (
            <Card className="mb-4">
              <Label>Running into lifting</Label>
              <p className="text-sm">
                Hard running landed within a day of a leg session{" "}
                {week.interference.length === 1 ? "once" : `${week.interference.length} times`} this week.
              </p>
              <ul className="mt-2 space-y-1">
                {week.interference.map((hit) => (
                  <li key={`${hit.runDate}-${hit.liftDate}`} className="tnum text-xs text-muted">
                    {hit.effort} run {hit.runDate} · legs {hit.liftDate}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">
                Both adaptations blunt when they stack. The half is the dated goal.
              </p>
            </Card>
          )}

          <Label>Runs</Label>
          <div className="space-y-2">
            {runs.map((run) => {
              const effort = classifyRun(run, baseline);
              return (
                <Card key={run.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium">{run.name || "Run"}</span>
                    <span className="tnum shrink-0 text-xs text-muted">{run.localDate}</span>
                  </div>
                  <div className="tnum mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted">
                    <span>{(Math.round(miles(run.distanceM ?? 0) * 10) / 10)} mi</span>
                    <span>{formatPace(paceSecPerMile(run.distanceM, run.durationS))}/mi</span>
                    <span>{Math.round(run.durationS / 60)} min</span>
                    {run.elevationM ? <span>{Math.round(feet(run.elevationM))} ft</span> : null}
                    {run.avgHr ? <span>{Math.round(run.avgHr)} bpm</span> : null}
                    <span className={
                      effort === "hard" ? "text-warn" : effort === "long" ? "text-accent" : ""
                    }>{effort}</span>
                  </div>
                  {run.verdict && <p className="mt-2 text-sm">{run.verdict}</p>}
                </Card>
              );
            })}
          </div>

          {history.length > 1 && (
            <>
              <Label>
                <span className="mt-6 block">Earlier weeks</span>
              </Label>
              <div className="space-y-2">
                {history.slice(1).map((row) => (
                  <Card key={row.weekStart}>
                    <div className="tnum text-xs text-muted">Week of {row.weekStart}</div>
                    <p className="mt-1 text-sm">{row.summary}</p>
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Screen>
  );
}

import Link from "next/link";
import { currentUserId } from "@/lib/supabase/server";
import { withUser } from "@/db";
import { redirect } from "next/navigation";
import {
  getProfile, localDate, getDayMeals, sumMacros, getMuscleVolume,
  getActiveTarget, getTdee, defaultProteinTarget, getActiveWorkout,
  getRuns, getLowerBodyLiftDates,
} from "@/lib/queries";
import { summarizeRunningWeek, weekStartOf, formatPace } from "@/lib/domain/running";
import { summarize } from "@/lib/domain/readiness";
import { Screen, Card, Label, MacroBar, Stat } from "@/components/ui";
import { WEEKLY_SET_TARGET } from "@/lib/domain/muscles";

export const dynamic = "force-dynamic";

export default async function Today() {
  const userId = await currentUserId();
  if (!userId) redirect("/login");

  // Read inside a user scope, so the RLS policies do the filtering here the
  // same way they do in the API routes. See withUser() in src/db/index.ts.
  const { today, meals, volume, target, tdee, proteinFloor, active, runs, lowerBodyDates } =
    await withUser(userId, async () => {
      const profile = await getProfile(userId);
      const today = localDate(profile?.tz ?? "America/New_York");
      const [meals, volume, target, tdee, proteinFloor, active, runs, lowerBodyDates] = await Promise.all([
        getDayMeals(userId, today),
        getMuscleVolume(userId, today),
        getActiveTarget(userId, today),
        getTdee(userId, today),
        defaultProteinTarget(userId),
        getActiveWorkout(userId),
        getRuns(userId, today),
        getLowerBodyLiftDates(userId, today),
      ]);
      return { today, meals, volume, target, tdee, proteinFloor, active, runs, lowerBodyDates };
    });

  const running = summarizeRunningWeek(runs, lowerBodyDates, weekStartOf(today));

  const totals = sumMacros(meals);
  const proteinTarget = target?.proteinG ?? proteinFloor;
  const due = volume.ranked.filter((r) => r.score > 0.2).slice(0, 4);

  return (
    <Screen
      title="Today"
      subtitle={new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      wide
    >
      {active && (
        <Link href="/lift" className="mb-4 block">
          <Card className="border-accent bg-accent-soft">
            <div className="flex items-center justify-between">
              <div>
                <Label>Session in progress</Label>
                <div className="text-sm">Tap to resume logging</div>
              </div>
              <span className="text-accent" aria-hidden>→</span>
            </div>
          </Card>
        </Link>
      )}

      <Card className="mb-4">
        <Label>Fuel</Label>
        <div className="mb-3 flex items-baseline gap-2">
          <span className="tnum text-3xl font-semibold">{Math.round(totals.kcal)}</span>
          <span className="text-sm text-muted">
            {target?.kcal ? `of ${target.kcal} kcal` : "kcal — no target yet, still calibrating"}
          </span>
        </div>
        <div className="space-y-2.5">
          <MacroBar label="Protein" value={totals.proteinG} target={proteinTarget} tone="good" />
          <MacroBar label="Carbs" value={totals.carbsG} target={target?.carbsG} />
          <MacroBar label="Fat" value={totals.fatG} target={target?.fatG} />
        </div>
        <Link href="/food" className="mt-3 block text-sm text-accent">
          {meals.length === 0 ? "Log your first meal →" : `${meals.length} meal${meals.length === 1 ? "" : "s"} logged →`}
        </Link>
      </Card>

      {/*
        This is what replaces a split. Ranked by volume debt gated on recovery,
        computed from what was actually logged — so improvising never puts it
        out of sync the way a fixed program does.
      */}
      <Card className="mb-4">
        <Label>Train next</Label>
        <p className="mb-3 text-sm">{summarize(volume.ranked)}</p>
        <div className="space-y-2">
          {due.length === 0 && (
            <p className="text-sm text-muted">
              Nothing is behind. Train whatever you feel like.
            </p>
          )}
          {due.map((r) => (
            <div key={r.muscle} className="flex items-baseline justify-between gap-3 border-t border-line pt-2 first:border-0 first:pt-0">
              <span className="text-sm font-medium">{r.label}</span>
              <span className="tnum text-xs text-muted">
                {Math.round(r.setsLast7d * 10) / 10}/{WEEKLY_SET_TARGET.min} sets
                {r.daysSinceTrained !== null ? ` · ${r.daysSinceTrained}d ago` : " · never"}
              </span>
            </div>
          ))}
        </div>
        <Link href="/lift" className="mt-3 block text-sm text-accent">
          {active ? "Resume session →" : "Start a lift →"}
        </Link>
      </Card>

      {/*
        Running sits above maintenance because the half marathon is the only
        goal with a date on it. It disappears entirely when there is nothing to
        say, rather than showing an empty card forever.
      */}
      {runs.length > 0 && (
        <Link href="/runs" className="mb-4 block">
          <Card>
            <Label>Running this week</Label>
            <div className="flex items-baseline gap-2">
              <span className="tnum text-3xl font-semibold">{running.thisWeek.distanceMi}</span>
              <span className="text-sm text-muted">
                mi · {formatPace(running.thisWeek.avgPaceSecPerMile)}/mi ·{" "}
                {running.thisWeek.runs} run{running.thisWeek.runs === 1 ? "" : "s"}
              </span>
            </div>
            {running.interference.length > 0 ? (
              <p className="mt-2 text-sm text-warn">
                Hard running stacked on a leg day{running.interference.length > 1 ? ` ${running.interference.length} times` : ""} this week.
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted">
                {running.lastWeek.distanceMi > 0
                  ? `${running.lastWeek.distanceMi} mi last week.`
                  : "First week of logged mileage."}
              </p>
            )}
            <span className="mt-3 block text-sm text-accent">See the week →</span>
          </Card>
        </Link>
      )}

      <Card>
        <Label>Measured maintenance</Label>
        {tdee.status === "ok" ? (
          <div className="flex items-end justify-between gap-4">
            <Stat
              label="TDEE"
              value={`${tdee.tdee}`}
              hint={`±${tdee.marginKcal} kcal · from ${tdee.weighIns} weigh-ins`}
            />
            <Stat
              label="Trend"
              value={`${tdee.trendKgPerWeek > 0 ? "+" : ""}${(tdee.trendKgPerWeek * 2.2046).toFixed(1)} lb/wk`}
            />
          </div>
        ) : (
          <p className="text-sm text-muted">
            Not enough weigh-ins for a reliable number — {tdee.weighIns} of {tdee.needed}.
            Weigh in most mornings and this fills itself in.
          </p>
        )}
        <Link href="/settings" className="mt-3 block text-sm text-accent">Log weight →</Link>
      </Card>
    </Screen>
  );
}

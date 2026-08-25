import Link from "next/link";
import { currentUserId } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  getProfile, localDate, getDayMeals, sumMacros, getMuscleVolume,
  getActiveTarget, getTdee, defaultProteinTarget, getActiveWorkout,
} from "@/lib/queries";
import { summarize } from "@/lib/domain/readiness";
import { Screen, Card, Label, MacroBar, Stat } from "@/components/ui";
import { WEEKLY_SET_TARGET } from "@/lib/domain/muscles";

export const dynamic = "force-dynamic";

export default async function Today() {
  const userId = await currentUserId();
  if (!userId) redirect("/login");

  const profile = await getProfile(userId);
  const tz = profile?.tz ?? "America/New_York";
  const today = localDate(tz);

  const [meals, volume, target, tdee, proteinFloor, active] = await Promise.all([
    getDayMeals(userId, today),
    getMuscleVolume(userId, today),
    getActiveTarget(userId, today),
    getTdee(userId, today),
    defaultProteinTarget(userId),
    getActiveWorkout(userId),
  ]);

  const totals = sumMacros(meals);
  const proteinTarget = target?.proteinG ?? proteinFloor;
  const due = volume.ranked.filter((r) => r.score > 0.2).slice(0, 4);

  return (
    <Screen
      title="Today"
      subtitle={new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
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

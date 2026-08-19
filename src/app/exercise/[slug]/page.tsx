import { currentUserId } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { db } from "@/db";
import { exercises } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getExerciseHistory } from "@/lib/queries";
import { computeBaseline, type PreviousSession } from "@/lib/domain/progression";
import { epley, totalVolumeKg } from "@/lib/domain/e1rm";
import { displayLb, platesPerSide } from "@/lib/domain/units";
import { Screen, Card, Label, Empty, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ExerciseDetail({ params }: { params: Promise<{ slug: string }> }) {
  const userId = await currentUserId();
  if (!userId) redirect("/login");

  const { slug } = await params;
  const [exercise] = await db.select().from(exercises).where(eq(exercises.id, slug)).limit(1);
  if (!exercise) notFound();

  const history = await getExerciseHistory(userId, exercise.id, 8);
  const sessions: PreviousSession[] = history.map((h) => ({
    date: h.date,
    sets: h.sets.map((s) => ({
      reps: s.reps, weightKg: s.weightKg, rpe: s.rpe,
      toFailure: s.toFailure, isWarmup: s.isWarmup,
    })),
  }));

  const baseline = computeBaseline(sessions, exercise.incrementKg);
  const e1rms = sessions
    .map((s) => {
      const work = s.sets.filter((x) => !x.isWarmup && x.reps <= 12);
      return work.length ? { date: s.date, e1rm: Math.max(...work.map((x) => epley(x.weightKg, x.reps))) } : null;
    })
    .filter((x): x is { date: string; e1rm: number } => x !== null)
    .reverse();

  const peak = e1rms.length ? Math.max(...e1rms.map((e) => e.e1rm)) : 0;
  const change = e1rms.length > 1 ? ((e1rms[e1rms.length - 1].e1rm - e1rms[0].e1rm) / e1rms[0].e1rm) * 100 : null;
  const plates = platesPerSide(baseline.weightKg);

  return (
    <Screen title={exercise.name} subtitle={`${exercise.equipment} · ${displayLb(exercise.incrementKg)} lb increment`}>
      <Card className="mb-4">
        <Label>Next time — the rule</Label>
        <div className="tnum text-2xl font-semibold">
          {baseline.action === "start" ? "—" : `${displayLb(baseline.weightKg)} lb × ${baseline.reps} × ${baseline.sets}`}
        </div>
        <p className="mt-1 text-sm text-muted">{baseline.reason}</p>
        {plates.length > 0 && (
          <p className="tnum mt-2 text-xs text-muted">
            Per side: {plates.join(" + ")}
          </p>
        )}
      </Card>

      {e1rms.length > 0 && (
        <Card className="mb-4">
          <div className="mb-3 flex items-end justify-between">
            <Stat label="Best e1RM" value={`${displayLb(peak)} lb`} />
            {change !== null && (
              <Stat
                label={`Over ${e1rms.length} sessions`}
                value={<span className={change >= 0 ? "text-good" : "text-bad"}>{change >= 0 ? "+" : ""}{change.toFixed(1)}%</span>}
              />
            )}
          </div>
          <div className="flex h-16 items-end gap-1" role="img" aria-label="Estimated one-rep-max trend">
            {e1rms.map((e) => (
              <div
                key={e.date}
                className="flex-1 rounded-sm bg-accent/70"
                style={{ height: `${Math.max(8, (e.e1rm / peak) * 100)}%` }}
                title={`${e.date}: ${displayLb(e.e1rm)} lb`}
              />
            ))}
          </div>
        </Card>
      )}

      <Label>History</Label>
      {history.length === 0 ? (
        <Empty>No sessions logged yet.</Empty>
      ) : (
        <div className="space-y-2">
          {history.map((h) => {
            const work = h.sets.filter((s) => !s.isWarmup);
            return (
              <Card key={h.date}>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-sm font-medium">
                    {new Date(`${h.date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  </span>
                  <span className="tnum text-xs text-muted">
                    {Math.round(displayLb(totalVolumeKg(work)))} lb volume
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {work.map((s, i) => (
                    <span key={i} className="tnum rounded border border-line-strong px-2 py-1 text-sm">
                      {displayLb(s.weightKg)} × {s.reps}
                      {s.rpe ? <span className="text-muted"> @{s.rpe}</span> : null}
                      {s.toFailure ? <span className="text-warn"> F</span> : null}
                    </span>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Screen>
  );
}

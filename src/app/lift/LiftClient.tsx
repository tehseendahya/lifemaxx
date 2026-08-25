"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Screen, Card, Label, Empty, Button } from "@/components/ui";
import { SetLogger, type OptimisticSet } from "@/components/SetLogger";
import { AskCoach } from "@/components/AskCoach";
import { OutboxBadge } from "@/components/OutboxBadge";
import { subscribeToOutbox } from "@/lib/outbox";

interface LoggedSet {
  id: string; exerciseId: string; exerciseName: string;
  reps: number; weightLb: number; rpe: number | null;
  toFailure: boolean; isWarmup: boolean; felt: string | null;
  clientId?: string | null;
  /** True while the set is still only on this phone. */
  pending?: boolean;
}

export function LiftClient({ active, sets, gyms, catalogue, due }: {
  active: { id: string; startedAt: string } | null;
  sets: LoggedSet[];
  gyms: { id: string; name: string }[];
  catalogue: { id: string; name: string; slug: string }[];
  due: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [gymId, setGymId] = useState<string>(gyms[0]?.id ?? "");

  /**
   * Sets that are in the outbox but not yet in the server's list.
   *
   * Logging must feel instant, and it must feel instant with no signal — so the
   * set is drawn the moment it is queued and dropped from here once the server
   * render comes back carrying the same clientId. Matching on clientId rather
   * than counting is what makes it safe: a refresh that lands mid-flight
   * neither duplicates the set nor loses it.
   */
  const [pending, setPending] = useState<OptimisticSet[]>([]);

  const serverClientIds = useMemo(
    () => new Set(sets.map((s) => s.clientId).filter(Boolean) as string[]),
    [sets],
  );

  useEffect(() => {
    setPending((current) => current.filter((p) => !serverClientIds.has(p.clientId)));
  }, [serverClientIds]);

  // Refresh on the edge, not on the level. The outbox publishes on every flush,
  // including the idle ones every thirty seconds — refreshing on "pending is 0"
  // would re-render the whole session forever. What matters is the moment the
  // queue *drains*, which is the only time the server has something new.
  const wasPending = useRef(0);
  useEffect(() => subscribeToOutbox((state) => {
    if (wasPending.current > 0 && state.pending === 0 && !state.syncing) router.refresh();
    wasPending.current = state.pending;
  }), [router]);

  async function start() {
    setBusy(true);
    await fetch("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gymId: gymId || null }),
    });
    setBusy(false);
    router.refresh();
  }

  async function stop() {
    if (!confirm("End this session?")) return;
    setBusy(true);
    const res = await fetch("/api/session/stop", { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (data.discarded) alert("Session had no sets, so it was discarded.");
    else if (data.workout) alert(`${data.workout.name}\n${data.summary.totalSets} sets in ${data.summary.durationMin} min`);
    router.refresh();
  }

  // Group by exercise, preserving the order they were first performed.
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; id: string; sets: LoggedSet[] }>();
    const all: LoggedSet[] = [
      ...sets,
      ...pending
        .filter((p) => !serverClientIds.has(p.clientId))
        .map((p) => ({ ...p, id: p.clientId, pending: true })),
    ];
    for (const s of all) {
      const g = map.get(s.exerciseId) ?? { name: s.exerciseName, id: s.exerciseId, sets: [] };
      g.sets.push(s);
      map.set(s.exerciseId, g);
    }
    return [...map.values()];
  }, [sets, pending, serverClientIds]);

  if (!active) {
    return (
      <Screen title="Lift" subtitle="Start a session and log as you go">
        <Card className="mb-4">
          <Label>Where</Label>
          {gyms.length > 0 ? (
            <select
              value={gymId}
              onChange={(e) => setGymId(e.target.value)}
              className="mb-3 w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm"
              aria-label="Gym"
            >
              {gyms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          ) : (
            <p className="mb-3 text-sm text-muted">
              No gyms saved yet — add one in Settings so the coach knows what equipment you have.
            </p>
          )}
          <Button onClick={start} disabled={busy} className="w-full">
            {busy ? "Starting…" : "Start lift"}
          </Button>
        </Card>

        {due.length > 0 && (
          <Card>
            <Label>Owed sets this week</Label>
            <p className="text-sm">{due.join(" · ")}</p>
            <p className="mt-2 text-xs text-muted">
              Ranked by volume debt and recovery. Train whatever you want — this just keeps score.
            </p>
          </Card>
        )}
      </Screen>
    );
  }

  return (
    <Screen
      title="Session"
      subtitle={<Elapsed from={active.startedAt} />}
      action={<Button variant="secondary" onClick={stop} disabled={busy}>Stop</Button>}
    >
      <OutboxBadge />

      <SetLogger
        catalogue={catalogue}
        onLogged={(optimistic) => {
          if (optimistic) setPending((current) => [...current, optimistic]);
          else router.refresh();
        }}
      />

      {grouped.length === 0 ? (
        <Empty>No sets yet. Pick an exercise above.</Empty>
      ) : (
        <div className="space-y-2">
          {grouped.map((g) => (
            <Card key={g.id}>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-medium">{g.name}</span>
                <a href={`/exercise/${g.id}`} className="text-xs text-accent">history →</a>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.sets.map((s) => (
                  <span
                    key={s.id}
                    title={s.pending ? "Saved on this phone, not yet synced" : undefined}
                    className={`tnum rounded border px-2 py-1 text-sm ${
                      s.isWarmup ? "border-line text-muted" : "border-line-strong"
                    } ${s.pending ? "border-dashed opacity-70" : ""}`}
                  >
                    {s.weightLb} × {s.reps}
                    {s.rpe ? <span className="text-muted"> @{s.rpe}</span> : null}
                    {s.toFailure ? <span className="text-warn"> F</span> : null}
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <AskCoach />
    </Screen>
  );
}

function Elapsed({ from }: { from: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const min = Math.max(0, Math.round((now - Date.parse(from)) / 60000));
  return <span className="tnum">{min} min elapsed</span>;
}

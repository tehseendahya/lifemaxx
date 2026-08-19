"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Screen, Card, Label, Button, Stat } from "@/components/ui";
import { MIN_WEIGH_INS } from "@/lib/domain/tdee";

type Tdee =
  | { status: "insufficient_data"; weighIns: number; needed: number }
  | { status: "ok"; tdee: number; marginKcal: number; trendKgPerWeek: number; currentKg: number; meanIntake: number; weighIns: number };

export function SettingsClient({ goalsText, email, currentWeightLb, tdee, proposals, gyms, weighInCount }: {
  goalsText: string;
  email: string;
  currentWeightLb: number | null;
  tdee: Tdee;
  proposals: { cut: number; maintain: number; bulk: number } | null;
  gyms: { id: string; name: string; equipmentNotes: string }[];
  weighInCount: number;
}) {
  const router = useRouter();
  const [goals, setGoals] = useState(goalsText);
  const [weight, setWeight] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function saveGoals() {
    setBusy(true);
    await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goalsText: goals }),
    });
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  async function logWeight() {
    if (!weight) return;
    setBusy(true);
    await fetch("/api/weight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weightLb: Number(weight) }),
    });
    setWeight("");
    setBusy(false);
    router.refresh();
  }

  return (
    <Screen title="You" subtitle={email}>
      {/* Weigh-in first: it's the daily action, and it's the input the whole
          TDEE loop depends on. Everything else here is set-and-forget. */}
      <Card className="mb-4">
        <Label>Morning weigh-in</Label>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder={currentWeightLb ? String(currentWeightLb) : "lb"}
            className="tnum flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-center text-lg outline-none"
            aria-label="Bodyweight in pounds"
          />
          <Button onClick={logWeight} disabled={busy || !weight}>Log</Button>
        </div>
        <p className="mt-2 text-xs text-muted">
          {weighInCount} weigh-in{weighInCount === 1 ? "" : "s"} in the last 28 days.
          {weighInCount < MIN_WEIGH_INS && ` ${MIN_WEIGH_INS - weighInCount} more for a maintenance estimate.`}
        </p>
      </Card>

      <Card className="mb-4">
        <Label>Goals</Label>
        <textarea
          value={goals}
          onChange={(e) => setGoals(e.target.value)}
          rows={4}
          placeholder="Running prep — half marathon in the fall. Want visible muscle size, especially shoulders and back. And abs."
          className="w-full resize-none rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted"
        />
        <p className="mt-2 text-xs text-muted">
          Written in your words and sent with every question. Be specific — “especially
          shoulders and back” changes what gets ranked up; “build muscle” doesn't.
        </p>
        <Button onClick={saveGoals} disabled={busy} className="mt-3 w-full">
          {saved ? "Saved" : busy ? "Saving…" : "Save goals"}
        </Button>
      </Card>

      <Card className="mb-4">
        <Label>Maintenance</Label>
        {tdee.status === "ok" ? (
          <>
            <div className="flex items-end justify-between gap-4">
              <Stat label="TDEE" value={tdee.tdee} hint={`±${tdee.marginKcal} kcal`} />
              <Stat label="Mean intake" value={tdee.meanIntake} hint="28-day" />
              <Stat
                label="Trend"
                value={`${tdee.trendKgPerWeek > 0 ? "+" : ""}${(tdee.trendKgPerWeek * 2.2046).toFixed(1)}`}
                hint="lb/week"
              />
            </div>
            {proposals && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="mb-2 text-sm">Targets from your own data:</p>
                <div className="tnum flex gap-4 text-sm">
                  <span>Cut <b>{proposals.cut}</b></span>
                  <span>Maintain <b>{proposals.maintain}</b></span>
                  <span>Bulk <b>{proposals.bulk}</b></span>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">
            Not enough weigh-ins for a reliable number — {tdee.weighIns} of {tdee.needed}.
            Rather than show you a calculator's guess, this stays blank until it can be measured.
          </p>
        )}
      </Card>

      <Card>
        <Label>Gyms</Label>
        {gyms.length === 0 ? (
          <p className="text-sm text-muted">
            No gyms yet. Adding one with its equipment notes stops the coach suggesting
            machines your gym doesn't have.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {gyms.map((g) => (
              <li key={g.id}>
                {g.name}
                {g.equipmentNotes && <span className="text-muted"> — {g.equipmentNotes}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Screen>
  );
}

"use client";
import { useEffect, useState } from "react";
import { Card, Label, Button } from "./ui";

interface Baseline { action: string; weightLb: number; sets: number; reps: number; reason: string }
interface Suggestion { weightLb: number; sets: number; reps: number; reason: string }

/**
 * Log a set, and show what to load before you do.
 *
 * The mechanical baseline and the model's suggestion appear side by side. When
 * the model deviates you can see it deviating and why — that's what keeps it
 * trustworthy over months rather than days. The baseline is computed locally
 * and always renders, even when the suggestion call fails or you're offline.
 */
export function SetLogger({ catalogue, onLogged }: {
  catalogue: { id: string; name: string }[];
  onLogged: () => void;
}) {
  const [exerciseId, setExerciseId] = useState("");
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [rpe, setRpe] = useState("");
  const [toFailure, setToFailure] = useState(false);
  const [isWarmup, setIsWarmup] = useState(false);
  const [felt, setFelt] = useState<"weak" | "normal" | "strong" | "">("");
  const [note, setNote] = useState("");
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"form" | "text">("form");

  useEffect(() => {
    if (!exerciseId) { setBaseline(null); setSuggestion(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/session/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exerciseId }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setBaseline(data.baseline);
        setSuggestion(data.suggestion);
        const target = data.suggestion ?? data.baseline;
        if (target?.weightLb) { setWeight(String(target.weightLb)); setReps(String(target.reps)); }
      } catch { /* offline — the form still works */ }
    })();
    return () => { cancelled = true; };
  }, [exerciseId]);

  async function logSet() {
    if (!exerciseId || !reps) return;
    setBusy(true);
    await fetch("/api/sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exerciseId,
        reps: Number(reps),
        weightLb: Number(weight) || 0,
        rpe: rpe ? Number(rpe) : null,
        toFailure, isWarmup, felt: felt || null, note,
      }),
    });
    setBusy(false);
    setRpe(""); setToFailure(false); setNote("");
    onLogged();
  }

  async function logText() {
    if (!text.trim()) return;
    setBusy(true);
    const res = await fetch("/api/sets/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    setBusy(false);

    if (data.unresolved?.length) {
      alert(`Couldn't match: ${data.unresolved.join(", ")}. Try the picker.`);
      return;
    }
    for (const entry of data.entries ?? []) {
      for (const s of entry.sets) {
        await fetch("/api/sets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            exerciseId: entry.exercise.id,
            reps: s.reps, weightLb: s.weight_lb, rpe: s.rpe,
            toFailure: s.to_failure, isWarmup: s.is_warmup, rawText: text,
          }),
        });
      }
    }
    setText("");
    onLogged();
  }

  return (
    <Card className="mb-4">
      <div className="mb-3 flex gap-2">
        <button
          onClick={() => setMode("form")}
          className={`font-mono text-[10px] uppercase tracking-[0.14em] ${mode === "form" ? "text-accent" : "text-muted"}`}
        >Picker</button>
        <button
          onClick={() => setMode("text")}
          className={`font-mono text-[10px] uppercase tracking-[0.14em] ${mode === "text" ? "text-accent" : "text-muted"}`}
        >Type it</button>
      </div>

      {mode === "text" ? (
        <>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="bench 5x5 185"
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm outline-none placeholder:text-muted"
          />
          <p className="mt-1.5 text-xs text-muted">
            Parsed on-device when it can be — no network needed for standard notation.
          </p>
          <Button onClick={logText} disabled={busy || !text.trim()} className="mt-3 w-full">
            {busy ? "Logging…" : "Log"}
          </Button>
        </>
      ) : (
        <>
          <select
            value={exerciseId}
            onChange={(e) => setExerciseId(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm"
            aria-label="Exercise"
          >
            <option value="">Pick an exercise…</option>
            {catalogue.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>

          {baseline && (
            <div className="mt-3 space-y-2">
              <div className="rounded-lg border border-line px-3 py-2">
                <Label>Baseline — the rule</Label>
                <div className="tnum text-sm text-muted">
                  {baseline.weightLb} lb × {baseline.reps} × {baseline.sets}
                </div>
                <p className="mt-1 text-xs text-muted">{baseline.reason}</p>
              </div>
              {suggestion && (
                <div className="rounded-lg border border-accent bg-accent-soft px-3 py-2">
                  <Label>Suggested</Label>
                  <div className="tnum text-lg font-semibold text-accent-ink">
                    {suggestion.weightLb} lb × {suggestion.reps} × {suggestion.sets}
                  </div>
                  <p className="mt-1 text-xs text-muted">{suggestion.reason}</p>
                </div>
              )}
            </div>
          )}

          <div className="mt-3 grid grid-cols-3 gap-2">
            <NumField label="Weight (lb)" value={weight} onChange={setWeight} />
            <NumField label="Reps" value={reps} onChange={setReps} />
            <NumField label="RPE" value={rpe} onChange={setRpe} placeholder="—" />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Toggle on={toFailure} onClick={() => setToFailure(!toFailure)}>To failure</Toggle>
            <Toggle on={isWarmup} onClick={() => setIsWarmup(!isWarmup)}>Warmup</Toggle>
            {(["weak", "normal", "strong"] as const).map((f) => (
              <Toggle key={f} on={felt === f} onClick={() => setFelt(felt === f ? "" : f)}>
                Felt {f}
              </Toggle>
            ))}
          </div>

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note — 'left shoulder pinched on set 3'"
            className="mt-3 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted"
          />

          <Button onClick={logSet} disabled={busy || !exerciseId || !reps} className="mt-3 w-full">
            {busy ? "Saving…" : "Log set"}
          </Button>
        </>
      )}
    </Card>
  );
}

function NumField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="tnum mt-1 w-full rounded-lg border border-line bg-surface-2 px-2 py-2.5 text-center outline-none"
      />
    </label>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3 py-1 text-xs ${
        on ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-muted"
      }`}
    >{children}</button>
  );
}

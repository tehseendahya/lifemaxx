"use client";
import { useRef, useState } from "react";
import { Card, Label, Button } from "./ui";

interface Item {
  name: string; qty: number | null; unit: string | null;
  kcal: number; protein_g: number; carbs_g: number; fat_g: number;
}

type Phase = "idle" | "analyzing" | "review" | "saving";

/**
 * Photo → macros, in about eight seconds.
 *
 * The image is resized in the browser before upload. That is not a nicety: a
 * 4MB phone photo over cell data is the difference between one second and
 * eight, and eight seconds is where people stop logging meals.
 *
 * The photo is never persisted. It goes to the model in memory and is dropped.
 */
export function MealCapture({ onSaved }: { onSaved: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState("");
  const [slot, setSlot] = useState<"breakfast" | "lunch" | "dinner" | "snack">(defaultSlot());
  const [confidence, setConfidence] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"photo" | "text">("photo");
  const fileRef = useRef<HTMLInputElement>(null);

  async function analyze(dataUrl?: string) {
    setPhase("analyzing");
    setError(null);
    try {
      const res = await fetch("/api/meals/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl, note }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Analysis failed");
      const data = await res.json();
      setItems(data.items);
      setConfidence(data.confidence);
      setPhase("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("idle");
    }
  }

  async function onFile(file: File) {
    setSource("photo");
    const dataUrl = await downscale(file, 1024, 0.8);
    await analyze(dataUrl);
  }

  async function save() {
    setPhase("saving");
    try {
      const res = await fetch("/api/meals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot, note, source, confidence, items }),
      });
      if (!res.ok) throw new Error("Save failed");
      setItems([]); setNote(""); setConfidence(null); setPhase("idle");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setPhase("review");
    }
  }

  const totals = items.reduce(
    (a, i) => ({
      kcal: a.kcal + i.kcal, p: a.p + i.protein_g, c: a.c + i.carbs_g, f: a.f + i.fat_g,
    }),
    { kcal: 0, p: 0, c: 0, f: 0 },
  );

  // "saving" keeps the review card mounted — otherwise it unmounts mid-save.
  if (phase === "review" || phase === "saving") {
    return (
      <Card className="mb-4">
        <Label>Check the numbers</Label>
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-2 border-b border-line pb-2 last:border-0">
              <input
                value={item.name}
                onChange={(e) => update(i, { name: e.target.value })}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
              <input
                type="number"
                inputMode="numeric"
                value={Math.round(item.kcal)}
                onChange={(e) => update(i, { kcal: Number(e.target.value) })}
                className="tnum w-16 rounded bg-surface-2 px-2 py-1 text-right text-sm outline-none"
                aria-label={`${item.name} calories`}
              />
              <input
                type="number"
                inputMode="numeric"
                value={Math.round(item.protein_g)}
                onChange={(e) => update(i, { protein_g: Number(e.target.value) })}
                className="tnum w-14 rounded bg-surface-2 px-2 py-1 text-right text-sm outline-none"
                aria-label={`${item.name} protein grams`}
              />
              <button
                onClick={() => setItems(items.filter((_, j) => j !== i))}
                className="px-1 text-muted"
                aria-label={`Remove ${item.name}`}
              >×</button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-baseline justify-between text-sm">
          <span className="text-muted">Total</span>
          <span className="tnum">
            {Math.round(totals.kcal)} kcal · {Math.round(totals.p)}p {Math.round(totals.c)}c {Math.round(totals.f)}f
          </span>
        </div>

        {confidence !== null && confidence < 0.6 && (
          <p className="mt-2 text-xs text-warn">
            Low confidence on this one. A note about portion size fixes it faster than anything else.
          </p>
        )}

        <div className="mt-3 flex gap-2">
          <select
            value={slot}
            onChange={(e) => setSlot(e.target.value as typeof slot)}
            className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
            aria-label="Meal slot"
          >
            <option value="breakfast">Breakfast</option>
            <option value="lunch">Lunch</option>
            <option value="dinner">Dinner</option>
            <option value="snack">Snack</option>
          </select>
          <Button onClick={save} disabled={phase === "saving" || items.length === 0} className="flex-1">
            {phase === "saving" ? "Saving…" : "Save meal"}
          </Button>
          <Button variant="ghost" onClick={() => { setItems([]); setPhase("idle"); }}>Cancel</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-4">
      <Label>Log a meal</Label>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What was it? Portion size matters more than the photo — 'about 2 cups of rice, thigh not breast'"
        rows={2}
        className="w-full resize-none rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted"
      />
      <div className="mt-3 flex gap-2">
        <Button onClick={() => fileRef.current?.click()} disabled={phase === "analyzing"} className="flex-1">
          {phase === "analyzing" ? "Reading…" : "📷 Photo"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => { setSource("text"); analyze(); }}
          disabled={phase === "analyzing" || !note.trim()}
          className="flex-1"
        >
          Text only
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
    </Card>
  );

  function update(i: number, patch: Partial<Item>) {
    setItems(items.map((item, j) => (j === i ? { ...item, ...patch } : item)));
  }
}

function defaultSlot(): "breakfast" | "lunch" | "dinner" | "snack" {
  const h = new Date().getHours();
  if (h < 10) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

/** Canvas downscale. 1024px longest edge at q0.8 lands around 120KB. */
async function downscale(file: File, maxEdge: number, quality: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

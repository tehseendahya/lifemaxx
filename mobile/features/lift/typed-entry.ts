import { enteredWeightToLb } from "@/components/ui/weight-entry";

/**
 * The laptop's typed weight and reps on the set card, read into the same
 * numbers the pad and the steppers produce.
 *
 * On the phone the figure between `−` and `+` is a button that opens the pad.
 * On a wide web window it is a text field — type, Tab to the next, Enter logs —
 * and these two functions decide what a field's text means. `null` means "not
 * a figure yet": the field is mid-edit, and the draft keeps whatever it had
 * rather than taking a half-typed value.
 */

/** Heavier than anything on a bar, in pounds; a typo past this is a typo. */
export const MAX_TYPED_LB = 2000;

/** The most reps one set plausibly has. Past it, the user meant something else. */
export const MAX_TYPED_REPS = 100;

const WEIGHT = /^\s*(\d+(?:\.\d*)?|\.\d+)\s*(kg|kgs|lb|lbs)?\s*$/i;

/**
 * A typed weight, in pounds.
 *
 * Pounds unless it says otherwise, because the card shows pounds. A trailing
 * `kg` is the pad's lb/kg toggle in typed form — the machine says 20 kg, you
 * type `20kg` — and it is converted at full precision for the same reason the
 * pad's is: storage is kg, and rounding here would stop a kg entry from
 * round-tripping. See `weight-entry.ts`.
 *
 * Zero is a real weight (bodyweight and assisted lifts log as 0 lb).
 */
export function parseTypedWeight(text: string): number | null {
  const m = WEIGHT.exec(text);
  if (m === null) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (m[2] ?? "lb").toLowerCase().startsWith("kg") ? "kg" : "lb";
  const lb = enteredWeightToLb(value, unit);
  return lb <= MAX_TYPED_LB ? lb : null;
}

/**
 * Typed reps: a whole number from 1.
 *
 * Zero is refused rather than clamped up as the pad does. The pad clamps
 * because DONE is final; a typed field is read on every keystroke, and a
 * transient "0" on the way to "10" must not flash the hero button to 1 rep.
 */
export function parseTypedReps(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const reps = Number(t);
  return reps >= 1 && reps <= MAX_TYPED_REPS ? reps : null;
}

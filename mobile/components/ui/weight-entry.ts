import { kgToLb, lbToKg } from "@/lib/shared/units";

/**
 * Entering a weight in kilograms on the number pad.
 *
 * The typed path has always accepted kg — "pec deck 2 sets 20kg for 8" parses
 * offline — but the pad was lb only, so the same lifter had to use two
 * different units depending on which door they came in through. The owner's
 * own paste mixed both in one session: bench in pounds, pec deck in kilos,
 * because that is what the machines are labelled in.
 *
 * ── WHY THE TOGGLE RELABELS RATHER THAN CONVERTS ───────────────────────────
 *
 * Tapping `kg` with "20" already typed means twenty kilograms. It does NOT
 * rescale to 44. The dominant flow is "I am entering a number in a unit", and
 * the moment you reach for the toggle is usually the moment you notice the
 * unit is wrong — so reinterpreting what you typed is what you meant, and
 * rescaling would quietly change the weight.
 *
 * The other need — "what is that in pounds" — is served by showing the
 * equivalent all the time instead of making the toggle do two jobs.
 *
 * ── WHY THE COMMITTED VALUE KEEPS FULL PRECISION ───────────────────────────
 *
 * Storage is kg; `weightLb` is only how the number crosses the wire, and the
 * server converts it straight back with `lbToKg`. So a kg entry round-trips
 * EXACTLY — 20 kg → 44.0924… lb → 20 kg — but only if nothing rounds in
 * between. Rounding to a whole pound here would store 19.96 kg for a plate
 * stack that says 20, and every later reading of that set would be a fraction
 * out. Rounding belongs at the display edge, which is what `equivalentLabel`
 * below is for, and nowhere else.
 */

export type WeightUnit = "lb" | "kg";

export const WEIGHT_UNITS: readonly WeightUnit[] = ["lb", "kg"];

/**
 * What the pad hands to the wire, which is always pounds.
 *
 * Full precision, deliberately. See the note above: this number is converted
 * back to kg by the server, and any rounding here is a permanent error in the
 * stored weight.
 */
export function enteredWeightToLb(value: number, unit: WeightUnit): number {
  return unit === "kg" ? kgToLb(value) : value;
}

/** The inverse, for prefilling the pad from a stored lb weight. */
export function lbToEnteredWeight(weightLb: number, unit: WeightUnit): number {
  return unit === "kg" ? lbToKg(weightLb) : weightLb;
}

/**
 * The muted line under the figure: what you typed, in the other unit.
 *
 * Pounds round to whole numbers — the owner reported "8r@44.1lb" as looking
 * broken, and a gym has no 0.1lb plate. Kilograms keep one decimal, because
 * 1 kg is 2.2 lb and rounding them to whole numbers would hide a real
 * difference rather than a meaningless one.
 *
 * Returns null when there is nothing typed yet, so the line does not flash a
 * "0 lb" at someone who has not entered anything.
 */
export function equivalentLabel(value: number | null, unit: WeightUnit): string | null {
  if (value === null || !Number.isFinite(value) || value === 0) return null;

  return unit === "kg"
    ? `${Math.round(kgToLb(value))} lb`
    : `${(Math.round(lbToKg(value) * 10) / 10).toFixed(1)} kg`;
}

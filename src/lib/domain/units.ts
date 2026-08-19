/**
 * Storage is always kg. Display is always lb (per the user's preference).
 * Conversion happens exactly once at each edge — never in the middle of a
 * calculation, which is how apps end up with 2.20462 sprinkled through
 * their business logic and 0.3lb rounding drift in their PR history.
 */
export const LB_PER_KG = 2.2046226218;

export const kgToLb = (kg: number): number => kg * LB_PER_KG;
export const lbToKg = (lb: number): number => lb / LB_PER_KG;

/** Round to the nearest displayable pound. Gyms don't have half-pound plates. */
export const displayLb = (kg: number): number => Math.round(kgToLb(kg) * 10) / 10;

/**
 * Snap a kg weight to something you can actually load.
 * Barbell plates come in 2.5lb pairs, so the real world quantum is 5lb.
 */
export function snapToLoadableKg(kg: number, incrementKg: number): number {
  if (incrementKg <= 0) return kg;
  return Math.round(kg / incrementKg) * incrementKg;
}

/** "185 lb" or "185 × 5". Tabular-friendly, no trailing .0 noise. */
export function formatWeight(kg: number, unit: "lb" | "kg" = "lb"): string {
  const v = unit === "lb" ? kgToLb(kg) : kg;
  const rounded = Math.round(v * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${unit}`;
}

/**
 * Which plates to hang on each side of a 45lb bar.
 * Returns lb-denominated plates, because that's what's on the rack.
 */
export function platesPerSide(totalKg: number, barKg = lbToKg(45)): number[] {
  const perSideLb = (kgToLb(totalKg) - kgToLb(barKg)) / 2;
  if (perSideLb <= 0) return [];
  const available = [45, 35, 25, 10, 5, 2.5];
  const out: number[] = [];
  let remaining = perSideLb;
  for (const plate of available) {
    while (remaining >= plate - 0.01) {
      out.push(plate);
      remaining -= plate;
    }
  }
  return out;
}

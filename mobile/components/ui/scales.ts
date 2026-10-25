/**
 * The geometry behind `charts.tsx`, with no `react-native` import.
 *
 * Split out for exactly one reason: there is no simulator in this project and
 * `vitest` runs in a plain node environment, so anything that imports
 * `react-native` cannot be tested at all. A chart that silently divides by zero
 * on a flat series, or puts every point at `NaN` when two weigh-ins land on the
 * same day, is a blank rectangle on a phone and a caught assertion here.
 *
 * ~40 lines rather than a charting library: `d3-scale` is 12kB of code to turn
 * three numbers into one, and the three numbers are the part worth testing.
 */

/** A value's vertical position in a box of `height`, inverted for screen space. */
export function yAt(v: number, domain: [number, number], height: number, pad = 0): number {
  const [y0, y1] = domain;
  const inner = Math.max(1, height - pad * 2);
  const spread = y1 - y0 || 1;
  return pad + (1 - (v - y0) / spread) * inner;
}

/** Evenly spaced index positions as 0..1 fractions. One point sits centred. */
export function xAt(i: number, n: number, width: number, pad = 0): number {
  const span = Math.max(1, width - pad * 2);
  if (n <= 1) return pad + span / 2;
  return pad + (i / (n - 1)) * span;
}

/**
 * The series' own min/max, padded by `fraction` — a sparkline is a shape, not
 * a scale, and that is the point of one.
 *
 * A flat series is widened to ±1 rather than left as a zero-width domain, so
 * "nothing changed" draws through the middle of the box instead of dividing by
 * zero and pinning the line to the top edge.
 */
export function yDomain(
  values: number[],
  reference: number | null = null,
  fraction = 0.04,
): [number, number] {
  const all = reference === null ? values : [...values, reference];
  if (all.length === 0) return [0, 1];
  const min = Math.min(...all);
  const max = Math.max(...all);
  if (max === min) return [min - 1, max + 1];
  const pad = (max - min) * fraction;
  return [min - pad, max + pad];
}

/**
 * Each point's position as a 0..1 fraction of the plot width.
 *
 * With `xs` the axis is whatever those numbers mean — day numbers, for a
 * calendar series. Two weigh-ins eight days apart are not two adjacent samples,
 * and even index spacing would draw them as though they were. Without `xs` the
 * points are spread evenly, which is correct for a sparkline of consecutive
 * sessions.
 */
export function xFractions(
  n: number,
  xs?: number[],
  domainX?: [number, number],
): number[] {
  if (n <= 0) return [];
  if (xs && xs.length === n) {
    const [x0, x1] = domainX ?? [Math.min(...xs), Math.max(...xs)];
    const spread = x1 - x0;
    // Every observation on the same day. One mark, centred — not a division by
    // zero that puts the whole series at NaN and renders as an empty box.
    if (spread <= 0) return xs.map(() => 0.5);
    return xs.map((x) => Math.min(1, Math.max(0, (x - x0) / spread)));
  }
  if (n === 1) return [0.5];
  return Array.from({ length: n }, (_, i) => i / (n - 1));
}

/** An `M/L` path through already-projected screen points. No smoothing, ever. */
export function linePath(points: { x: number; y: number }[]): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");
}

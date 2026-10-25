/**
 * The fixed cell widths of one set row in the confirmation sheet.
 *
 * These live in their own module for one reason: they are the fix for the bug
 * the owner hit first, and in `SetLine.tsx` they could not be tested. That file
 * imports `react-native`, and the mobile vitest config is a plain node
 * environment with no RN runtime, so nothing could assert them. An adversarial
 * pass proved the cost by mutation — it set `rpe` back to the original 32 and
 * all 608 tests still passed. The fix rested entirely on arithmetic in a
 * comment.
 *
 * ── THE BUG ────────────────────────────────────────────────────────────────
 *
 * The owner put RPE 10 on a set and the badge rendered as "@1" on one line and
 * "0" on the next, pushing into the controls beside it. The RPE cell was 32pt
 * and "@10" is the widest string that control can produce.
 *
 * ── THE BUDGET ─────────────────────────────────────────────────────────────
 *
 * The narrowest iPhone this targets is 375pt. The sheet takes a 16pt gutter on
 * each side and the row group is inset a further 12pt, which leaves 331pt for
 * the whole row. The cells below sum to `ROW_WIDTH_TOTAL` and the gap between
 * the figures and the controls is one `space.sm`.
 *
 * Both assertions in `row-widths.test.ts` are load-bearing and neither is
 * redundant:
 *
 *   · the per-cell floor catches the actual regression. The original bug sums
 *     to 298pt, comfortably inside the row budget, so a total-only assertion
 *     would have passed on the broken layout.
 *   · the total catches the opposite mistake — widening a cell until the row
 *     stops fitting on a 375pt screen.
 *
 * `MIN_RPE_WIDTH` is 44 rather than the measured 42.6pt that "@10" needs at
 * 15pt type: 44 is also the iOS minimum touch target, and this cell is
 * tappable.
 */

export const ROW_WIDTHS = {
  weight: 66,
  reps: 52,
  kind: 30,
  rpe: 46,
  note: 30,
  icon: 38,
} as const;

/** Sum of every fixed cell. */
export const ROW_WIDTH_TOTAL = Object.values(ROW_WIDTHS).reduce((a, b) => a + b, 0);

/**
 * What "@10" needs at 15pt with the system text size at its default, rounded
 * up to the iOS touch-target minimum.
 */
export const MIN_RPE_WIDTH = 44;

/**
 * 375pt screen − 2×16pt sheet gutter − 12pt group inset, minus the 8pt gap
 * between the figures and the controls.
 */
export const ROW_WIDTH_BUDGET = 375 - 32 - 12 - 8;

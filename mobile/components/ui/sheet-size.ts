/**
 * How tall a bottom sheet's panel is allowed to be, kept out of the component.
 *
 * `Sheet` imports `react-native` and therefore cannot be unit tested here, but
 * the arithmetic that keeps its title out from under the status bar clock can
 * be — and that arithmetic was a real bug, not a theoretical one. The
 * confirmation sheet grew one card per set; at fifteen sets the panel was taller
 * than the screen, and because `Sheet`'s root is `justifyContent: "flex-end"`
 * the overflow went off the TOP of the screen rather than the bottom. The
 * title rendered behind the clock.
 */

/**
 * The gap between the status bar and the top of a full-height panel.
 *
 * Not zero: a panel that stops exactly at the inset looks like a screen, not a
 * sheet. 24pt of the session behind it is what makes it read as something laid
 * over the app — which is the whole reason this flow uses a sheet.
 *
 * This is `space.xxl`, written out rather than imported: `tokens.ts` imports
 * `react-native` for `Platform.select`, and the entire point of this module is
 * that it loads in the node test environment. `sheet-size.test.ts` reads
 * `tokens.ts` as *text* and fails if the two ever drift — the same guard
 * `tokens.test.ts` already uses against `globals.css`.
 */
export const SHEET_TOP_GAP = 24;

/**
 * The smallest panel this will ever clamp to.
 *
 * Only reachable on a window shorter than any device the app runs on (an
 * iPhone SE is 667pt tall). It exists so that a bad or very early
 * `useWindowDimensions` reading cannot produce a zero-height panel, which would
 * look exactly like the app failing to open the sheet at all.
 */
export const SHEET_MIN_HEIGHT = 120;

/** Used when the window height is not known yet; tall enough to cap nothing. */
const UNBOUNDED = 9999;

export function sheetMaxHeight(windowHeight: number, insetTop: number): number {
  // A first frame can report 0 before layout. Capping to 0 would hide the
  // sheet; leaving it uncapped for one frame is the pre-existing behaviour and
  // the panel is re-measured as soon as a real height arrives.
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return UNBOUNDED;

  const reserved = Math.max(0, insetTop) + SHEET_TOP_GAP;
  return Math.max(SHEET_MIN_HEIGHT, windowHeight - reserved);
}

/**
 * The same cap for the laptop's centred dialog (`Sheet` and `NumberPad` on a
 * wide web window), which needs a margin above AND below: a dialog that touched
 * the bottom edge would look like a sheet that had lost its way.
 */
export const DIALOG_MARGIN = 48;

export function dialogMaxHeight(windowHeight: number): number {
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return UNBOUNDED;
  return Math.max(SHEET_MIN_HEIGHT, windowHeight - 2 * DIALOG_MARGIN);
}

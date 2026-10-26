import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DIALOG_MARGIN, SHEET_MIN_HEIGHT, SHEET_TOP_GAP, dialogMaxHeight, sheetMaxHeight,
} from "./sheet-size";

/**
 * The guard on the safe-area bug: a sheet's title must never be able to render
 * under the status bar clock.
 *
 * What this can prove is the invariant — that the panel's top edge is always at
 * least the status-bar inset plus a gap below the top of the window, for every
 * window size and inset a phone can report, no matter how tall the content is.
 * What it cannot prove is the pixel position on a device, because there is no
 * device here. The layout above this (title inside the panel, under an 8pt pad
 * and a 4pt grabber) only ever pushes the title further down.
 */

/** Every iPhone the app can run on, plus two absurd ones. */
const WINDOWS = [667, 736, 812, 844, 852, 896, 926, 932, 1024, 1366];
/** No inset (a device with a bezel), a notch, and a Dynamic Island. */
const INSETS = [0, 20, 44, 47, 59];

describe("sheetMaxHeight", () => {
  it("always leaves the status bar and a gap above the panel", () => {
    for (const windowHeight of WINDOWS) {
      for (const insetTop of INSETS) {
        const panelTop = windowHeight - sheetMaxHeight(windowHeight, insetTop);
        expect(panelTop).toBeGreaterThanOrEqual(insetTop + SHEET_TOP_GAP);
      }
    }
  });

  it("caps a panel whose content would be taller than the screen", () => {
    // The fifteen-set case: 15 lines at 56pt plus five headers is well past
    // 1000pt of content, and the panel must not become that tall.
    const max = sheetMaxHeight(844, 47);
    expect(max).toBe(844 - 47 - SHEET_TOP_GAP);
    expect(max).toBeLessThan(1000);
  });

  it("does not shrink a sheet that already fits — the cap is a ceiling, not a height", () => {
    // A 300pt sheet on a 844pt screen is unaffected: `maxHeight` only binds
    // when the content exceeds it, so one-line entries look exactly as before.
    expect(sheetMaxHeight(844, 47)).toBeGreaterThan(300);
  });

  it("leaves the panel uncapped while the window height is still unknown", () => {
    // A zero reading on the first frame must not produce a zero-height panel,
    // which would be indistinguishable from the sheet failing to open.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sheetMaxHeight(bad, 47)).toBeGreaterThan(1000);
    }
  });

  it("never clamps below a usable height, even on a window no device has", () => {
    expect(sheetMaxHeight(100, 47)).toBe(SHEET_MIN_HEIGHT);
  });

  it("treats a negative inset as zero rather than growing the panel", () => {
    expect(sheetMaxHeight(844, -10)).toBe(844 - SHEET_TOP_GAP);
  });

  /**
   * The gap is `space.xxl` and is written out in `sheet-size.ts` because that
   * module must load without `react-native`. This is the drift guard, and it
   * reads `tokens.ts` as text for exactly the same reason.
   */
  it("keeps SHEET_TOP_GAP equal to space.xxl in tokens.ts", () => {
    const tokens = readFileSync(path.join(__dirname, "tokens.ts"), "utf8");
    const match = /xxl:\s*(\d+)/.exec(tokens);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(SHEET_TOP_GAP);
  });
});

describe("dialogMaxHeight (the laptop's centred dialog)", () => {
  it("leaves a margin above and below", () => {
    for (const windowHeight of [600, 720, 900, 1080, 1440]) {
      expect(windowHeight - dialogMaxHeight(windowHeight)).toBeGreaterThanOrEqual(2 * DIALOG_MARGIN);
    }
  });

  it("never clamps to nothing, and caps nothing before the window is measured", () => {
    expect(dialogMaxHeight(100)).toBe(SHEET_MIN_HEIGHT);
    expect(dialogMaxHeight(0)).toBeGreaterThan(5000);
    expect(dialogMaxHeight(Number.NaN)).toBeGreaterThan(5000);
  });
});

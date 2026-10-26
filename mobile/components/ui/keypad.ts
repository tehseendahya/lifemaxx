/**
 * The digit-string rules behind `NumberPad`, kept out of the component.
 *
 * `NumberPad` is controlled and never parses, clamps or validates a value — it
 * emits a raw string and the caller converts. But "raw" still has to mean a
 * string that `Number()` can read, which is the whole of what lives here. It is
 * pure so it can be unit-tested; the component around it cannot be, since there
 * is no device in CI.
 */

/** A pressable key, or `null` for the inert slot where `.` would be. */
export type PadKey = string | null;

export const BACKSPACE = "⌫";

/**
 * Six characters. Enough for `1000.5`, which is heavier than anything anyone
 * will put on a bar in pounds, and short enough that a stuck finger cannot
 * produce a number the server has to reject.
 */
export const MAX_LENGTH = 6;

/**
 * The 3x4 layout, row-major.
 *
 * The `.` slot stays in the grid as an inert `null` when decimals are off,
 * rather than collapsing and sliding `0` left. Reps and RPE use an integer pad
 * and weight uses a decimal one, and a `0` key that moves between them would
 * break the muscle memory of the one flow this whole app exists to make fast.
 */
export function padKeys(allowDecimal: boolean): PadKey[] {
  return [
    "1", "2", "3",
    "4", "5", "6",
    "7", "8", "9",
    allowDecimal ? "." : null, "0", BACKSPACE,
  ];
}

/**
 * Apply a key press to the current value and return the next value.
 *
 * Unknown keys, and `null` from the inert slot, return the value unchanged, so
 * the component can hand every grid cell straight to this function.
 */
export function applyKey(value: string, key: PadKey, allowDecimal: boolean): string {
  if (key === null) return value;
  if (key === BACKSPACE) return value.slice(0, -1);

  if (key === ".") {
    if (!allowDecimal) return value;
    if (value.includes(".")) return value;
    // A bare "." is not a number. Typing the point first means "nought point".
    return value === "" ? "0." : `${value}.`;
  }

  if (!/^[0-9]$/.test(key)) return value;

  // Reject a leading run of zeros: "0" then "7" is 7, not "07", and "0" then
  // "0" stays "0". A leading zero is only meaningful before a decimal point,
  // which is handled above and leaves "0." — not "0" — in the value.
  const next = value === "0" ? key : value + key;

  return next.length > MAX_LENGTH ? value : next;
}

/**
 * The same thing, for a value nobody has touched yet.
 *
 * The pad opens PREFILLED — with the weight you lifted last set, the macro the
 * model estimated, yesterday's bodyweight. Until now the first digit appended
 * to that, so going from 220 to 225 by typing `225` produced `220225`. The
 * owner reported exactly that:
 *
 *   "If there is already a weight in, and I open it and start typing, it
 *    should erase the current weight and start typing the new weight."
 *
 * So a prefill behaves like selected text: the first digit replaces it. Which
 * is also what the readout already implied — a figure sitting there with a
 * cursor nowhere is a value you are about to overwrite, not one you are
 * appending to.
 *
 * ── BACKSPACE IS THE EXCEPTION, AND IT EARNS IT ────────────────────────────
 *
 * Selected text would be wiped by `⌫`. Here it edits in place instead: 220
 * becomes 22, and one more key makes 225. That is TWO taps for the commonest
 * correction on this pad — one plate up — where retyping the figure is three
 * and wiping it is four. The press also ends the replacing state, so the digit
 * after a backspace appends like any other.
 *
 * A leading `.` replaces too, and lands on `0.` rather than `220.`, which is
 * the consistent reading of "the first key starts a new number".
 */
export function applyFirstKey(value: string, key: PadKey, allowDecimal: boolean): string {
  if (key === BACKSPACE) return applyKey(value, key, allowDecimal);

  const started = applyKey("", key, allowDecimal);
  /*
   * A key that does nothing to an EMPTY value does nothing at all — the inert
   * `.` slot on an integer pad, `null`, anything that is not a digit. Those
   * must leave the prefill alone, and the first version of this did not: it
   * started from `""` unconditionally, so `.` on a reps pad silently wiped the
   * figure. Unreachable through the grid, which renders that slot as an inert
   * `View`, and exactly the kind of thing one refactor makes reachable.
   */
  return started === "" ? value : started;
}

/**
 * What the pad shows while the value is empty.
 *
 * A blank readout looks broken, and a zero that is indistinguishable from a
 * typed zero is worse — the caller needs to know the difference, because an
 * untouched field should fall back to a suggested weight rather than to 0 lb.
 * So the *value* stays `""` and only the display is substituted.
 */
export function displayValue(value: string): string {
  return value === "" ? "0" : value;
}

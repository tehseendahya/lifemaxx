import { describe, expect, it } from "vitest";
import {
  applyFirstKey, applyKey, BACKSPACE, displayValue, MAX_LENGTH, padKeys, typedValue,
} from "./keypad";

/** Press a whole string of keys in order, the way a thumb would. */
function type(keys: string, allowDecimal = true, from = ""): string {
  return [...keys].reduce((v, k) => applyKey(v, k, allowDecimal), from);
}

describe("padKeys", () => {
  it("is always twelve cells, so the 0 key never moves", () => {
    expect(padKeys(true)).toHaveLength(12);
    expect(padKeys(false)).toHaveLength(12);
    expect(padKeys(true)[10]).toBe("0");
    expect(padKeys(false)[10]).toBe("0");
  });

  it("blanks the decimal slot instead of removing it", () => {
    expect(padKeys(true)[9]).toBe(".");
    expect(padKeys(false)[9]).toBeNull();
  });
});

describe("applyKey", () => {
  it("appends digits", () => {
    expect(type("185")).toBe("185");
  });

  it("drops a leading run of zeros", () => {
    expect(type("0")).toBe("0");
    expect(type("00")).toBe("0");
    expect(type("0000")).toBe("0");
    expect(type("07")).toBe("7");
    expect(type("0045")).toBe("45");
  });

  it("keeps a zero that precedes a decimal point", () => {
    expect(type("0.5")).toBe("0.5");
    expect(type("00.5")).toBe("0.5");
  });

  it("reads a leading point as nought point", () => {
    expect(type(".5")).toBe("0.5");
  });

  it("accepts only one decimal point", () => {
    expect(type("2.5.5")).toBe("2.55");
    expect(type("1..")).toBe("1.");
  });

  it("ignores the decimal key when decimals are off", () => {
    expect(type("2.5", false)).toBe("25");
  });

  it("caps the length and keeps accepting backspace afterwards", () => {
    expect(type("1234567")).toBe("123456");
    expect(type("1234567").length).toBe(MAX_LENGTH);
    expect(applyKey("123456", BACKSPACE, true)).toBe("12345");
  });

  it("counts the decimal point against the length", () => {
    expect(type("1000.55")).toBe("1000.5");
  });

  it("backspaces to empty and no further", () => {
    expect(applyKey("5", BACKSPACE, true)).toBe("");
    expect(applyKey("", BACKSPACE, true)).toBe("");
  });

  it("ignores the inert slot and anything unexpected", () => {
    expect(applyKey("45", null, true)).toBe("45");
    expect(applyKey("45", "x", true)).toBe("45");
    expect(applyKey("45", "-", true)).toBe("45");
  });

  it("never produces a string Number() cannot read", () => {
    const keys = [...padKeys(true), "x", "-"];
    let value = "";
    // A deterministic walk over the pad: every reachable state must be numeric.
    for (let i = 0; i < 400; i++) {
      value = applyKey(value, keys[(i * 7) % keys.length], true);
      if (value !== "") expect(Number.isNaN(Number(value))).toBe(false);
    }
  });
});

describe("displayValue", () => {
  it("shows a zero for an untouched field without putting one in the value", () => {
    expect(displayValue("")).toBe("0");
    expect(displayValue("0")).toBe("0");
    expect(displayValue("1.5")).toBe("1.5");
  });
});

describe("typing over a prefilled value", () => {
  /**
   * The owner's report, in one line: *"if I go up to 225 on one set it'd say
   * 220225 instead of 225"*.
   *
   * The pad opens prefilled from the last set, the model's estimate or
   * yesterday's bodyweight, and until now the first digit appended to that.
   */

  it("replaces the prefill with the first digit instead of appending", () => {
    // The reported bug, exactly: 220 on screen, "225" typed.
    let value = "220";
    value = applyFirstKey(value, "2", true);
    value = applyKey(value, "2", true);
    value = applyKey(value, "5", true);
    expect(value).toBe("225");
  });

  it("would have produced the reported 220225 without it", () => {
    // Documents what this function is for, so it cannot be deleted as a
    // needless wrapper around `applyKey`.
    let value = "220";
    for (const key of ["2", "2", "5"]) value = applyKey(value, key, true);
    expect(value).toBe("220225");
  });

  it("backspaces the prefill in place rather than wiping it", () => {
    // Two taps for one plate up, which is the commonest correction there is —
    // wiping to "" would make it four.
    let value = applyFirstKey("220", BACKSPACE, true);
    expect(value).toBe("22");
    value = applyKey(value, "5", true);
    expect(value).toBe("225");
  });

  it("starts a new number from a leading decimal point", () => {
    expect(applyFirstKey("220", ".", true)).toBe("0.");
    expect(applyFirstKey("220", ".", false)).toBe("220");
  });

  it("behaves exactly like applyKey when there is no prefill", () => {
    for (const key of padKeys(true)) {
      expect(applyFirstKey("", key, true)).toBe(applyKey("", key, true));
    }
  });

  it("ignores the inert slot, like applyKey does", () => {
    expect(applyFirstKey("220", null, false)).toBe("220");
  });

  it("cannot produce a value longer than the pad allows", () => {
    // Replacing makes this nearly impossible to hit, but a six-digit prefill
    // backspaced and retyped must still obey the ceiling.
    let value = applyFirstKey("999999", "1", true);
    for (const key of ["2", "3", "4", "5", "6", "7", "8"]) value = applyKey(value, key, true);
    expect(value.length).toBeLessThanOrEqual(MAX_LENGTH);
  });

  it("never produces a string Number() cannot read", () => {
    for (const prefill of ["220", "0", "0.5", "", "1000.5"]) {
      for (const key of [...padKeys(true), "x", "-"]) {
        const next = applyFirstKey(prefill, key, true);
        if (next !== "") expect(Number.isNaN(Number(next)), `${prefill} + ${key}`).toBe(false);
      }
    }
  });
});

describe("typedValue (the laptop's typed readout)", () => {
  it("keeps what the pad would have produced", () => {
    expect(typedValue("185", true)).toBe("185");
    expect(typedValue("227.5", true)).toBe("227.5");
    expect(typedValue("12", false)).toBe("12");
  });

  it("drops what a key press could not have typed", () => {
    expect(typedValue("185 lb", true)).toBe("185");
    expect(typedValue("abc", true)).toBe("");
    expect(typedValue("1,5", false)).toBe("15");
  });

  it("refuses a point on an integer field, and a second point on a decimal one", () => {
    expect(typedValue("8.5", false)).toBe("85");
    expect(typedValue("1.2.3", true)).toBe("1.23");
  });

  it("reads a leading point as nought point, and collapses leading zeros", () => {
    expect(typedValue(".5", true)).toBe("0.5");
    expect(typedValue("007", true)).toBe("7");
  });

  it("stops at the pad's length limit", () => {
    expect(typedValue("12345678", true)).toHaveLength(MAX_LENGTH);
  });
});

import { describe, expect, it } from "vitest";
import { applyKey, BACKSPACE, displayValue, MAX_LENGTH, padKeys } from "./keypad";

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

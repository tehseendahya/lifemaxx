import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards the one claim `tokens.ts` makes that cannot be checked by typechecking
 * or by bundling: that its hex values are the web app's hex values.
 *
 * The brief for this port is "copy the values, do not eyeball them" — so this
 * reads both files as *text* and compares the literals. Reading them as text
 * rather than importing `tokens.ts` is deliberate twice over: the module pulls
 * in `react-native` for `Platform.select`, which has no business running under
 * plain Node; and comparing source literals catches the failure that matters,
 * which is someone hand-editing one file and not the other.
 */

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, "..", "..", "..", "src", "app", "globals.css");
const tokensPath = resolve(here, "tokens.ts");

/** `--color-surface-2` is `surface2` here; `--color-line-strong` is `lineStrong`. */
function camel(cssName: string): string {
  return cssName.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function cssColors(): Map<string, string> {
  const css = readFileSync(cssPath, "utf8");
  const out = new Map<string, string>();
  for (const m of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out.set(camel(m[1]), m[2].toLowerCase());
  }
  return out;
}

function tokenColors(): Map<string, string> {
  const src = readFileSync(tokensPath, "utf8");
  const block = /export const color = \{([\s\S]*?)\} as const;/.exec(src);
  if (!block) throw new Error("could not find the `color` object in tokens.ts");
  const out = new Map<string, string>();
  for (const m of block[1].matchAll(/(\w+):\s*"(#[0-9a-fA-F]{3,8})"/g)) {
    out.set(m[1], m[2].toLowerCase());
  }
  return out;
}

describe("tokens.ts mirrors globals.css", () => {
  it("finds the palette in both files", () => {
    // If either regex stops matching, every assertion below passes vacuously.
    expect(cssColors().size).toBeGreaterThanOrEqual(13);
    expect(tokenColors().size).toBeGreaterThanOrEqual(13);
  });

  it("defines exactly the same colour names", () => {
    expect([...tokenColors().keys()].sort()).toEqual([...cssColors().keys()].sort());
  });

  it("agrees on every hex value", () => {
    const css = cssColors();
    for (const [name, hex] of tokenColors()) {
      expect(hex, `color.${name} does not match --color-* in globals.css`).toBe(css.get(name));
    }
  });
});

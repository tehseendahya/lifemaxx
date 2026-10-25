import type { TextStyle } from "react-native";

import { color, font } from "@/components/ui/tokens";

/**
 * The handful of values the navigation chrome needs — the tab bar, the root
 * stack's content background, the boot spinner.
 *
 * This started life as a hand-copied duplicate of `components/ui/tokens.ts`,
 * written before that file existed, on the reasoning that the chrome is
 * configured before any feature renders and must not depend on the component
 * layer. At integration the duplication was retired: `tokens.ts` imports
 * nothing but `react-native` and exports no component, so pointing at it
 * creates no dependency on anything that renders — and `tokens.test.ts` guards
 * those hex values against `src/app/globals.css`, which this file's copies were
 * not guarded against. Two palettes, one of them untested, is exactly how the
 * tab bar ends up a slightly different grey from the cards above it.
 *
 * It stays as its own module rather than becoming an import of
 * `@/components/ui`: that barrel pulls in twelve components, and the root
 * layout has no reason to bundle `NumberPad` to colour a tab bar.
 */
export const shell = {
  ground: color.ground,
  surface: color.surface,
  line: color.line,
  ink: color.ink,
  muted: color.muted,
  accent: color.accent,
  bad: color.bad,
} as const;

/**
 * 10pt mono uppercase with wide tracking — the micro-label voice, everywhere.
 *
 * Deliberately WITHOUT a colour, which is the one way this differs from
 * `microLabel` in `components/ui/Label.tsx`. It is passed straight to
 * `tabBarLabelStyle`, and an explicit colour there beats
 * `tabBarActiveTintColor` — so inheriting the component layer's `color:
 * color.muted` would leave every tab label muted and the selected tab
 * indistinguishable from the other three.
 */
export const microLabel: TextStyle = {
  fontFamily: font.mono,
  fontSize: 10,
  letterSpacing: 1.4,
  textTransform: "uppercase",
};

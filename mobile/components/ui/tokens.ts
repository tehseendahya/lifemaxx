import { Platform } from "react-native";
import type { TextStyle } from "react-native";

/**
 * The design tokens, transcribed from `src/app/globals.css`.
 *
 * The user did not complain about how the app looks, so the visual language is
 * being ported rather than redesigned. Every hex below is a copy of a
 * `--color-*` custom property in that file — none of it was picked by eye, and
 * `tokens.test.ts` reads both files and fails if they ever drift apart.
 *
 * Dark only. There is no light palette and nothing calls `useColorScheme`:
 * `app.json` sets `userInterfaceStyle: "dark"`, and the web app is `color-scheme:
 * dark` with no light variant either. A half-finished light mode is worse than
 * none.
 */
export const color = {
  ground: "#0d1013",
  surface: "#15191d",
  surface2: "#1c2126",
  line: "#262d33",
  lineStrong: "#39424a",
  ink: "#e8ebe9",
  muted: "#8e979f",
  accent: "#7fa7ff",
  accentInk: "#a9c2ff",
  accentSoft: "#16233c",
  good: "#5cc08c",
  warn: "#e0a35c",
  bad: "#e07a6b",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;

export const radius = { sm: 6, md: 8, lg: 12, xl: 16, pill: 999 } as const;

export const font = {
  /**
   * The micro-label face. `--font-mono` on the web is `ui-monospace, "SF Mono",
   * Menlo, monospace`; on iOS the first two are not addressable by name from
   * React Native, and Menlo is a system face, so it needs no `expo-font` and no
   * asset pipeline — one fewer thing that can fail on `expo start`.
   *
   * `default` covers the react-native-web smoke target, where "monospace" is a
   * real CSS generic.
   */
  mono: Platform.select({ ios: "Menlo", default: "monospace" }),
} as const;

/**
 * The port of the web's `.tnum` class.
 *
 * Spread into the style of every `Text` that renders a figure — weights, reps,
 * macros, pace, timers, set counts. Without it, proportional digits make a
 * column of weights jitter as it updates, which is the most visible possible
 * regression from the web app. It is baked into the numeric components here so
 * that feature code cannot forget it.
 *
 * Typed through `TextStyle` rather than `as const`: `fontVariant` wants a
 * mutable `FontVariant[]`, and a `readonly` tuple is not assignable to it.
 */
export const tnum: { fontVariant: TextStyle["fontVariant"] } = {
  fontVariant: ["tabular-nums"],
};

/**
 * Tap targets. 44 is Apple's floor and the minimum for anything tappable; 56
 * and 72 exist because the primary action in a flow is pressed with chalky
 * hands, at arm's length, while out of breath, and a 44pt button is not enough
 * for that. The hero size is for "LOG SET".
 */
export const hit = { min: 44, big: 56, huge: 72 } as const;

/**
 * Bottom padding every scrolling screen reserves: the tab bar, the rest-timer
 * bar that can appear above it mid-session, and the home indicator. Content
 * must clear all three, and overlays (`NumberPad`, `Sheet`) float above this
 * gutter rather than pushing the layout up.
 */
export const SCROLL_BOTTOM_INSET = 96;

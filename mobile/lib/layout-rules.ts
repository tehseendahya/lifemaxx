/**
 * The laptop layout's decisions, with no `react-native` import.
 *
 * `lib/layout.ts` wraps these in hooks; they live here so the node test runner
 * can load them. Every rule that decides whether a phone sees something
 * different is in this file, because "the phone stays exactly as it is" is the
 * constraint the whole laptop layout was built under, and a rule that cannot be
 * tested is a rule that can quietly start applying to the phone.
 */

/**
 * The narrowest window that gets the laptop layout.
 *
 * 900, not 768: a sidebar of `SIDEBAR_WIDTH` plus two card columns of about
 * 320 each is the least that reads as two columns rather than two slivers. A
 * tablet-width browser window below that gets the phone layout, which is
 * already right for it.
 */
export const WIDE_MIN_WIDTH = 900;

/** The centred content column. Wider than this and a line of prose gets too long to read. */
export const CONTENT_MAX_WIDTH = 1100;

export const SIDEBAR_WIDTH = 220;

/** A dialog's width on the laptop: a sheet's content, not a page's. */
export const DIALOG_MAX_WIDTH = 560;

/** The full-screen pickers and editors, as dialogs. Wider: they hold lists. */
export const PANEL_MAX_WIDTH = 720;

/**
 * Whether this window gets the laptop layout.
 *
 * Web only, whatever the width. An iPad in landscape is wider than 900 points
 * and is still a touch device running the native app, where a sidebar and
 * typed number fields would both be wrong; and a phone browser is narrow, so
 * it gets the phone layout by width. Both halves of the condition are load-
 * bearing, and the test covers each one failing alone.
 */
export function isWideLayout(platform: string, width: number): boolean {
  return platform === "web" && Number.isFinite(width) && width >= WIDE_MIN_WIDTH;
}

// --------------------------------------------------------------- the sidebar

export type NavKey = "today" | "lift" | "food" | "runs" | "coach" | "you";

export interface NavItem {
  key: NavKey;
  label: string;
  /** Where the item goes. Runs and Coach are root stack screens, the rest are tabs. */
  href: "/" | "/lift" | "/food" | "/runs" | "/coach" | "/you";
  /** The same glyphs the phone's tab bar uses, plus the web nav's two. */
  glyph: string;
}

/**
 * Six places, in the old web nav's order.
 *
 * Runs and Coach are a pushed screen and a modal on the phone, where a 390pt
 * bar cannot spare them a slot (see `app/(tabs)/_layout.tsx`). On a laptop
 * there is room, and they are places you go, so they are back in the list.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "today", label: "Today", href: "/", glyph: "◎" },
  { key: "lift", label: "Lift", href: "/lift", glyph: "▮" },
  { key: "food", label: "Food", href: "/food", glyph: "◍" },
  { key: "runs", label: "Runs", href: "/runs", glyph: "↗" },
  { key: "coach", label: "Coach", href: "/coach", glyph: "◆" },
  { key: "you", label: "You", href: "/you", glyph: "○" },
];

/**
 * Which item is lit for a pathname.
 *
 * The two drill-downs light the place they are reached from: an exercise's
 * history and a past workout are both opened from Lift, so leaving Lift dark
 * while one is open would make the sidebar say you are nowhere. `null` for a
 * route that belongs to no place (sign-in, the smoke route), which lights
 * nothing rather than guessing.
 */
export function activeNav(pathname: string): NavKey | null {
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  if (path === "/") return "today";
  const first = path.split("/")[1] ?? "";
  switch (first) {
    case "lift":
    case "exercise":
    case "workout":
      return "lift";
    case "food":
      return "food";
    case "runs":
      return "runs";
    case "coach":
      return "coach";
    case "you":
      return "you";
    default:
      return null;
  }
}

/** Root stack screens rather than tabs. Moving between two of them must not pile up history. */
const STACK_SCREENS = new Set(["runs", "coach", "exercise", "workout"]);

/**
 * How a sidebar click moves.
 *
 * `none` for the place you are already on. `replace` when both ends are root
 * stack screens — Runs to Coach — so clicking around the sidebar does not build
 * a stack of screens that the browser's back button then has to unwind one at
 * a time. `navigate` otherwise, which is what pops back down to the tabs when
 * the target is one of them.
 */
export function navMove(pathname: string, target: NavItem): "none" | "replace" | "navigate" {
  if (activeNav(pathname) === target.key && pathname.split("?")[0] === target.href) return "none";
  const here = pathname.split("?")[0].split("/")[1] ?? "";
  const there = target.href.split("/")[1] ?? "";
  return STACK_SCREENS.has(here) && STACK_SCREENS.has(there) ? "replace" : "navigate";
}

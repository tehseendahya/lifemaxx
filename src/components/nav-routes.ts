export const TABS = [
  { href: "/", label: "Today", icon: "◎" },
  { href: "/food", label: "Food", icon: "◍" },
  { href: "/lift", label: "Lift", icon: "▮" },
  { href: "/runs", label: "Runs", icon: "◇" },
  { href: "/coach", label: "Coach", icon: "◆" },
  { href: "/settings", label: "You", icon: "○" },
] as const;

/**
 * Screens shown before there is a session, which therefore have no navigation.
 *
 * Shared so the shell's sidebar gutter and the sidebar itself cannot disagree:
 * if only one of them knew, /login would render offset against empty space.
 */
export const BARE = ["/login", "/reset-password"];

export const isBare = (path: string) => BARE.includes(path);

export const isActive = (path: string, href: string) =>
  href === "/" ? path === "/" : path.startsWith(href);

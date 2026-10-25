/**
 * The handful of colours the navigation chrome needs.
 *
 * These are the same values as `src/app/globals.css` (`--color-ground`,
 * `--color-surface`, `--color-line`, `--color-accent`, `--color-muted`,
 * `--color-ink`) — the visual language is being ported, not redesigned, so
 * nothing here was picked by eye.
 *
 * It is a deliberate duplicate of `mobile/components/ui/tokens.ts`, which is
 * the canonical palette feature code imports. The tab bar and the root stack
 * are configured before any feature renders and must not depend on the
 * component layer, so the six values the chrome needs are repeated here rather
 * than creating a dependency from `app/` into `components/`. If these ever
 * disagree, `globals.css` is right and both are wrong.
 */
export const shell = {
  ground: "#0d1013",
  surface: "#15191d",
  line: "#262d33",
  ink: "#e8ebe9",
  muted: "#8e979f",
  accent: "#7fa7ff",
  bad: "#e07a6b",
} as const;

/** 10pt Menlo uppercase with wide tracking — the micro-label voice, everywhere. */
export const microLabel = {
  fontFamily: "Menlo",
  fontSize: 10,
  letterSpacing: 1.4,
  textTransform: "uppercase",
} as const;

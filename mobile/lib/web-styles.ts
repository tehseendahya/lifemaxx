import { Platform } from "react-native";

import { color } from "@/components/ui/tokens";

/**
 * The few things a browser needs that a style prop cannot say.
 *
 * Hover: react-native-web already gives every `Pressable` a pointer cursor, but
 * no hover state, and the app has thirty-odd pressables written for a thumb. A
 * mouse moving over a control that does not react reads as broken. Rather than
 * thread a `hovered` style through every one of them, one rule keys off the
 * ARIA role that `accessibilityRole` already renders — so every button gets the
 * same hover, and a pressable written tomorrow gets it for free. Brightness
 * rather than a background colour: it works on the accent fill, on a ghost
 * button's grey text and on a whole tappable row alike.
 *
 * Focus: a visible ring for keyboard focus only (`:focus-visible`), because Tab
 * now moves between the set fields on a laptop and you have to see where it is.
 *
 * `color-scheme: dark` so the browser's own scrollbars and form controls match
 * an app that has no light mode.
 *
 * Installed once from the root layout. Does nothing off the web.
 */

const STYLE_ID = "lifemaxx-web";

const INTERACTIVE = ["button", "link", "tab", "switch", "radio", "checkbox"]
  .map((role) => `[role="${role}"]:not([aria-disabled="true"])`);

const CSS = `
:root { color-scheme: dark; }
html, body { background-color: ${color.ground}; }
${INTERACTIVE.join(",\n")} { transition: filter 120ms ease-out; }
${INTERACTIVE.map((s) => `${s}:hover`).join(",\n")} { filter: brightness(1.22); }
${INTERACTIVE.map((s) => `${s}:focus-visible`).join(",\n")},
input:focus-visible, textarea:focus-visible {
  outline: 2px solid ${color.accent};
  outline-offset: 2px;
}
input:focus, textarea:focus { outline-color: ${color.accent}; }
@media (prefers-reduced-motion: reduce) {
  ${INTERACTIVE.join(",\n")} { transition: none; }
}
`;

export function installWebStyles(): void {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

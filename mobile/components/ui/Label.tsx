import { StyleSheet, Text } from "react-native";
import type { ReactNode } from "react";
import type { StyleProp, TextStyle } from "react-native";

import { color, font, space } from "./tokens";

/**
 * The mono micro-label voice, without the trailing gap.
 *
 * Exported separately because not everything that uses this type scale wants
 * `Label`'s 8pt bottom margin — `Stat` sets its label 2pt above the figure, the
 * way the web app does. Features should reach for `Label`; this is for the
 * components in this folder.
 *
 * 1.4 rather than a ratio: the web's `tracking-[0.14em]` at `text-[10px]` is
 * 1.4px, and React Native's `letterSpacing` is absolute.
 */
export const microLabel: TextStyle = {
  fontFamily: font.mono,
  fontSize: 10,
  letterSpacing: 1.4,
  textTransform: "uppercase",
  color: color.muted,
};

const styles = StyleSheet.create({
  label: { ...microLabel, marginBottom: space.sm },
});

/**
 * The micro-label that sits above almost every card's contents.
 *
 * Use this and never an ad-hoc styled `Text`: it appears a dozen times on a
 * screen, and a mono uppercase label that is 11pt on one card and 10pt on the
 * next is the kind of drift nobody can name but everybody sees.
 */
export function Label({ children, style }: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[styles.label, style]}>{children}</Text>;
}

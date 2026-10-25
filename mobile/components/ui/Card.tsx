import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

import { color, radius, space } from "./tokens";

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.xl,
    padding: space.lg,
    marginBottom: space.md,
  },
  accent: {
    backgroundColor: color.accentSoft,
    borderColor: color.accent,
  },
});

/**
 * The surface everything sits on — the port of the web's `<Card>`.
 *
 * Carries its own bottom margin, so a screen is a plain stack of cards with no
 * spacer views and no `gap` on the parent. That is how the web app composes
 * and it keeps the two codebases reading the same.
 *
 * `tone="accent"` is the highlighted variant the web uses for a progression
 * suggestion: the soft accent fill with a full-strength accent border.
 */
export function Card({ children, tone = "default", style }: {
  children: ReactNode;
  tone?: "default" | "accent";
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.card, tone === "accent" && styles.accent, style]}>
      {children}
    </View>
  );
}

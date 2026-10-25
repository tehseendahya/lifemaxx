import { StyleSheet, Text } from "react-native";
import type { ReactNode } from "react";

import { color, radius, space } from "./tokens";

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.line,
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingVertical: space.xxl,
    marginBottom: space.md,
  },
  text: { color: color.muted, fontSize: 13, textAlign: "center", lineHeight: 19 },
});

/**
 * The nothing-here state — a dashed outline rather than a solid card, so an
 * empty slot never reads as a thing that failed to load.
 *
 * Carries the same bottom margin as `Card`, because it stands in for one.
 */
export function Empty({ children }: { children: ReactNode }) {
  return <Text style={[styles.box, styles.text]}>{children}</Text>;
}

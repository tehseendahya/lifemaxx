import { StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";

import { color, radius, space, tnum } from "./tokens";

const styles = StyleSheet.create({
  pill: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs + 1,
    borderColor: color.lineStrong,
  },
  warmup: { borderColor: color.line },
  /**
   * A set that is on the phone but not yet on the server.
   *
   * Ported from the web's `border-dashed opacity-70`. The opacity is doing most
   * of the work on purpose: React Native's dashed borders combined with a
   * corner radius are not reliably dashed on iOS, and this must still read as
   * "not synced yet" if the dashes render solid. There is no way to confirm
   * which way it lands without a device.
   */
  queued: { borderStyle: "dashed", opacity: 0.7 },
  text: { ...tnum, color: color.ink, fontSize: 14 },
  warmupText: { color: color.muted },
});

/**
 * The read-only set chip — `185 × 6`, `45 × 6 @8`.
 *
 * Tabular numerals are not optional here: these wrap into rows of six or eight
 * and they have to line up. The figure is wrapped in a `tnum` `Text`, so a
 * nested `<Text>` for the muted `@8` or the warn-coloured `F` inherits them.
 */
export function Pill({ children, variant = "default" }: {
  children: ReactNode;
  variant?: "default" | "warmup" | "queued";
}) {
  return (
    <View style={[styles.pill, variant === "warmup" && styles.warmup, variant === "queued" && styles.queued]}>
      <Text style={[styles.text, variant === "warmup" && styles.warmupText]}>{children}</Text>
    </View>
  );
}

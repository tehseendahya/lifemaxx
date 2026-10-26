import { StyleSheet, View } from "react-native";

import { color, space } from "./tokens";

/**
 * A row of 8pt dots: filled for done, hollow for not yet, outlined for today.
 *
 * The cold-start pattern's one visual. "3 of 8 weigh-ins" as a sentence is
 * read; as eight dots with three filled it is seen, and it visibly moves every
 * morning — which is the whole job during the weeks there is no chart to show.
 *
 * Imported by path (`@/components/ui/ProgressDots`), not through the barrel:
 * the barrel has no owner this round and two workstreams editing it at once is
 * a merge conflict by construction.
 *
 * Not a status colour. Filled is `accent`, the same mark as a lifted day on the
 * lift-day grid; hollow is a `line` ring, so an unfilled dot reads as "not yet"
 * rather than as a failure.
 */

export type DotState = "on" | "off" | "current";

const DOT = 8;

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.xs + 2, alignItems: "center" },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 1 },
  on: { backgroundColor: color.accent, borderColor: color.accent },
  off: { backgroundColor: "transparent", borderColor: color.lineStrong },
  // Today, not yet done: an accent ring, so "still open" differs from "missed".
  current: { backgroundColor: "transparent", borderColor: color.accent },
});

export function ProgressDots(
  props: { filled: number; total: number } | { states: DotState[] },
) {
  const states: DotState[] = "states" in props
    ? props.states
    : Array.from({ length: Math.max(0, props.total) }, (_, i) => (i < props.filled ? "on" : "off"));

  const on = states.filter((s) => s === "on").length;

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${on} of ${states.length}`}
    >
      {states.map((s, i) => (
        // Keyed by index: the dots are positional and never reorder.
        <View key={i} style={[styles.dot, styles[s]]} />
      ))}
    </View>
  );
}

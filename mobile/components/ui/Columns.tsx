import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import { useIsWide } from "@/lib/layout";

import { space } from "./tokens";

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.lg },
  // `minWidth: 0` so a long unbroken line inside a card wraps instead of
  // pushing its column wider than half the row.
  column: { flex: 1, minWidth: 0 },
});

/**
 * Two stacks of cards side by side on a laptop, one stack on a phone.
 *
 * On a narrow window this renders `left` and then `right` with nothing around
 * them — no wrapper view, no gap — so a phone screen built from it is the same
 * tree of cards it was before `Columns` existed, in the same order. That order
 * is the phone's reading order, which is why the left column is whatever the
 * phone shows first.
 *
 * Each column is an independent stack, not a grid row: cards keep their own
 * heights and each side flows on its own, which is right for a dashboard where
 * a tall chart next to a short list is the normal case.
 */
export function Columns({ left, right }: { left: ReactNode; right: ReactNode }) {
  const wide = useIsWide();

  if (!wide) {
    return (
      <>
        {left}
        {right}
      </>
    );
  }

  return (
    <View style={styles.row}>
      <View style={styles.column}>{left}</View>
      <View style={styles.column}>{right}</View>
    </View>
  );
}

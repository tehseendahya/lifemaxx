import { StyleSheet, Text, View } from "react-native";

import { color, space, tnum } from "@/components/ui";
import { ProgressDots } from "@/components/ui/ProgressDots";

import type { CalibrationView } from "./unlock";

/**
 * The two dot tracks behind "maintenance calories": weigh-ins and food days.
 *
 * One component for Today's Unlocking row and You's calibration card, fed by
 * one function (`calibrationView`), so the two screens cannot show different
 * counts for the same eight days. No number appears anywhere in it — not a
 * greyed-out maintenance figure, not an estimate. The counts are the content.
 */

const styles = StyleSheet.create({
  track: { flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.sm },
  trackLabel: { ...tnum, color: color.muted, fontSize: 12, width: 112 },
  footer: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: space.md },
});

export function CalibrationRows({ view, footer = true }: {
  view: CalibrationView;
  /** Today prints the footer once at the foot of the whole Unlocking card. */
  footer?: boolean;
}) {
  return (
    <View>
      <View style={styles.track}>
        <Text style={styles.trackLabel}>
          {view.weighIns.have} of {view.weighIns.need} weigh-ins
        </Text>
        <ProgressDots filled={view.weighIns.have} total={view.weighIns.need} />
      </View>
      <View style={styles.track}>
        <Text style={styles.trackLabel}>
          {view.foodDays.have} of {view.foodDays.need} food days
        </Text>
        <ProgressDots filled={view.foodDays.have} total={view.foodDays.need} />
      </View>
      {footer && <Text style={styles.footer}>{view.footer}</Text>}
    </View>
  );
}

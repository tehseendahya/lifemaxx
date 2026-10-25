import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, hit, microLabel, radius, space } from "@/components/ui";
import { tapSelect } from "@/lib/haptics";

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.pill,
  },
  arrow: {
    width: hit.min,
    height: hit.min,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowGlyph: { color: color.accent, fontSize: 18 },
  arrowOff: { color: color.muted, opacity: 0.4 },
  pressed: { opacity: 0.7 },
  label: { ...microLabel, color: color.ink, minWidth: 54, textAlign: "center" },
  // Keeps the pill from touching the arrows' hit areas while leaving them 44pt.
  labelBox: { paddingHorizontal: space.xs },
});

/**
 * `‹ today ›` in the header.
 *
 * A date picker would be two taps and a dismissal to answer a question that is
 * almost always "yesterday". The forward arrow is inert on today rather than
 * hidden, so the control does not change width as the user walks back through
 * the week — a header that reflows under your thumb is the kind of thing this
 * port exists to stop doing.
 */
export function DateStepper({ label, canBack, canForward, onBack, onForward }: {
  label: string;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => { tapSelect(); onBack(); }}
        disabled={!canBack}
        style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Previous day"
        accessibilityState={{ disabled: !canBack }}
      >
        <Text style={[styles.arrowGlyph, !canBack && styles.arrowOff]}>‹</Text>
      </Pressable>

      <View style={styles.labelBox}>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
      </View>

      <Pressable
        onPress={() => { tapSelect(); onForward(); }}
        disabled={!canForward}
        style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Next day"
        accessibilityState={{ disabled: !canForward }}
      >
        <Text style={[styles.arrowGlyph, !canForward && styles.arrowOff]}>›</Text>
      </Pressable>
    </View>
  );
}

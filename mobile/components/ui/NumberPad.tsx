import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "./Button";
import { Label } from "./Label";
import { BACKSPACE, applyKey, displayValue, padKeys } from "./keypad";
import { color, radius, space, tnum } from "./tokens";
import { useSlideIn } from "./useSlideIn";

/** Big enough to hit without looking, which is the entire point. */
const KEY_HEIGHT = 64;

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { backgroundColor: "#000000" },
  panel: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: color.line,
    paddingTop: space.lg,
  },
  readout: {
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  valueRow: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  value: { ...tnum, color: color.ink, fontSize: 34, fontWeight: "600" },
  /** An untouched field shows a muted zero, so "0" typed is not "0" assumed. */
  valueEmpty: { color: color.muted },
  unit: { color: color.muted, fontSize: 16 },

  grid: { borderTopWidth: 1, borderColor: color.line },
  row: { flexDirection: "row" },
  key: {
    flex: 1,
    height: KEY_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 1,
    borderColor: color.line,
  },
  keyDivider: { borderLeftWidth: 1, borderColor: color.line },
  keyPressed: { backgroundColor: color.surface2 },
  keyText: { ...tnum, color: color.ink, fontSize: 22, fontWeight: "500" },
  keyTextWide: { fontSize: 20 },

  done: { paddingHorizontal: space.lg, paddingTop: space.lg },
});

/**
 * The number entry for every weight, rep, RPE and bodyweight in the app.
 *
 * This exists instead of a `TextInput` with `keyboardType="decimal-pad"`, and
 * it is the direct fix for three of the complaints that started this project:
 *
 *  - *Keyboard.* The system keyboard animates in over 250ms, and on a screen
 *    that is not already a form it shoves the layout upward and then back down.
 *    This is a `Modal` overlay: the content behind it does not move at all,
 *    because `Screen` already reserves the bottom gutter it floats over.
 *  - *Tap latency.* Focusing a `TextInput` costs a round trip to the native
 *    text system before the first keystroke registers. These keys are
 *    `Pressable`s; the first press is the first digit.
 *  - *Too many taps.* No focus tap, no "next field" tap, no keyboard dismissal.
 *    Open, type, DONE.
 *
 * Controlled and pure: it never parses, clamps or validates. It emits the raw
 * digit string and the caller converts — a weight of `""` must be able to mean
 * "untouched, use the suggestion" rather than 0 lb, and only the caller knows
 * that. The string is always something `Number()` can read; see `keypad.ts`.
 *
 * It fires no haptics, for the same reason `Button` does not: a key press, a
 * save and a cancel should not feel alike, and only the feature knows which is
 * which. Call `tapSelect()` from `onChange` and `tapSave()` from `onDone`.
 */
export function NumberPad({
  visible,
  value,
  label,
  unit,
  allowDecimal = false,
  onChange,
  onDone,
  onCancel,
}: {
  visible: boolean;
  /** The raw digit string. `""` means untouched. */
  value: string;
  /** Shown as a micro-label above the figure: "WEIGHT", "REPS", "BODYWEIGHT". */
  label: string;
  /** "lb", "kg", "reps" — muted, beside the figure. */
  unit?: string;
  /** Weight and bodyweight: true. Reps: false. */
  allowDecimal?: boolean;
  onChange: (next: string) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { mounted, onPanelLayout, backdropStyle, panelStyle } = useSlideIn(visible);

  if (!mounted) return null;

  const keys = padKeys(allowDecimal);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
        </Pressable>

        <Animated.View
          onLayout={onPanelLayout}
          style={[styles.panel, panelStyle, { paddingBottom: insets.bottom + space.md }]}
        >
          <View style={styles.readout}>
            <Label>{label}</Label>
            <View style={styles.valueRow}>
              <Text style={[styles.value, value === "" && styles.valueEmpty]}>
                {displayValue(value)}
              </Text>
              {unit ? <Text style={styles.unit}>{unit}</Text> : null}
            </View>
          </View>

          <View style={styles.grid}>
            {[0, 3, 6, 9].map((start) => (
              <View key={start} style={styles.row}>
                {keys.slice(start, start + 3).map((key, i) => {
                  // The inert slot where `.` would be: same footprint, no press,
                  // so `0` never moves between the integer and decimal pads.
                  if (key === null) {
                    return <View key={`blank-${i}`} style={[styles.key, i > 0 && styles.keyDivider]} />;
                  }

                  const isBackspace = key === BACKSPACE;

                  return (
                    <Pressable
                      key={key}
                      onPress={() => onChange(applyKey(value, key, allowDecimal))}
                      accessibilityRole="button"
                      accessibilityLabel={isBackspace ? "Delete" : key}
                      style={({ pressed }) => [
                        styles.key,
                        i > 0 && styles.keyDivider,
                        pressed && styles.keyPressed,
                      ]}
                    >
                      <Text style={[styles.keyText, isBackspace && styles.keyTextWide]}>{key}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>

          <View style={styles.done}>
            <Button size="lg" variant="primary" onPress={onDone}>DONE</Button>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

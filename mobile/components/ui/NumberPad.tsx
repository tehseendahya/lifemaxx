import { useEffect, useState } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "./Button";
import { Label } from "./Label";
import { BACKSPACE, applyFirstKey, applyKey, displayValue, padKeys } from "./keypad";
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
  /** The lb/kg toggle, sitting on the figure's baseline. */
  units: { flexDirection: "row", marginLeft: "auto", gap: 2 },
  unitKey: {
    minWidth: 44,          // iOS touch target; this is tapped mid-set.
    paddingVertical: 6,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  unitKeyOn: { backgroundColor: color.accentSoft },
  unitKeyText: { ...tnum, color: color.muted, fontSize: 14, fontWeight: "600" },
  unitKeyTextOn: { color: color.accentInk },

  /** "44 lb" under a kg figure. Muted: it is a reading, not the entry. */
  equivalent: { ...tnum, color: color.muted, fontSize: 14, marginTop: 2 },

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
 * The one piece of state it keeps is whether the figure on screen is still the
 * PREFILL the caller opened with, because the first digit replaces a prefill
 * rather than appending to it — see `applyFirstKey`. That is selection state,
 * not value state: a text field tracks its own selection too, and the value is
 * still entirely the caller's. Keeping it here rather than in the five screens
 * that open this pad is also the only way all five behave the same.
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
  units,
  equivalent,
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
  /**
   * Offer a unit choice beside the figure. Omit it for anything with one unit
   * — reps, macros — which then renders exactly as before.
   */
  units?: {
    options: readonly string[];
    value: string;
    onChange: (next: string) => void;
  };
  /**
   * The muted line under the figure: what was typed, in the other unit. The
   * caller computes it, because only the caller knows what the figure means.
   */
  equivalent?: string | null;
  onChange: (next: string) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { mounted, onPanelLayout, backdropStyle, panelStyle } = useSlideIn(visible);

  /*
   * Reset on OPEN rather than on a change of `value`.
   *
   * The caller sets the prefill and opens the pad in the same batch, so there
   * is no separate "the value changed" moment to hang this on — and hanging it
   * on `value` would re-arm the replace every time the caller echoed a digit
   * back, which is every keystroke. An open is the only event that means "this
   * figure is a suggestion, not something you typed".
   *
   * `visible` is also what every caller flips between two fields: the weight
   * pad closes before the reps pad opens, because the control that opens
   * either one is behind this modal.
   */
  const [replacing, setReplacing] = useState(true);
  useEffect(() => {
    if (visible) setReplacing(true);
  }, [visible]);

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

              {/*
                * The unit toggle, only when the caller offers a choice. Reps
                * and macros have one unit and get no control.
                *
                * It RELABELS rather than converts: tapping `kg` with "20"
                * typed means twenty kilograms, not forty-four. See the note in
                * `weight-entry.ts` — reaching for this control is usually the
                * moment you notice the unit is wrong, so reinterpreting is
                * what you meant.
                */}
              {units ? (
                <View style={styles.units}>
                  {units.options.map((option) => {
                    const active = option === units.value;
                    return (
                      <Pressable
                        key={option}
                        // Haptics are the caller's job here, as they are for
                        // every other key on this pad.
                        onPress={() => { if (!active) units.onChange(option); }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`Enter in ${option === "kg" ? "kilograms" : "pounds"}`}
                        style={[styles.unitKey, active && styles.unitKeyOn]}
                      >
                        <Text style={[styles.unitKeyText, active && styles.unitKeyTextOn]}>
                          {option}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>

            {/*
              * What you typed, in the other unit. Always visible once there is
              * a figure, so the toggle never has to do two jobs — and so the
              * owner can see "44 lb" while typing against a 20 kg stack.
              */}
            {equivalent ? <Text style={styles.equivalent}>{equivalent}</Text> : null}
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
                      onPress={() => {
                        onChange(
                          replacing
                            ? applyFirstKey(value, key, allowDecimal)
                            : applyKey(value, key, allowDecimal),
                        );
                        // Every real key ends it, backspace included: after 220
                        // becomes 22, the next digit has to append.
                        setReplacing(false);
                      }}
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

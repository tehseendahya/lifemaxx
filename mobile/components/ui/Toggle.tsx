import { Pressable, StyleSheet, Text } from "react-native";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

import { color, hit, radius, space } from "./tokens";

const styles = StyleSheet.create({
  chip: {
    minHeight: hit.min,
    paddingHorizontal: space.md,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: radius.pill,
    backgroundColor: "transparent",
  },
  off: { borderColor: color.line },
  offText: { color: color.muted },
  onAccent: { borderColor: color.accent, backgroundColor: color.accentSoft },
  onAccentText: { color: color.accentInk },
  /**
   * There is no `--color-warn-soft` in `globals.css`, and inventing a hex here
   * would be exactly the eyeballing this port is meant to avoid — so the warn
   * state fills with `surface2` to carry the same visual weight as the accent
   * state and lets the border and text do the talking.
   */
  onWarn: { borderColor: color.warn, backgroundColor: color.surface2 },
  onWarnText: { color: color.warn },
  text: { fontSize: 13, fontWeight: "500" },
  pressed: { opacity: 0.7 },
});

/**
 * A pill chip that is on or off — RPE, to-failure, warmup, felt-state.
 *
 * The web version is 28pt tall, which is fine for a mouse and not for a thumb
 * mid-set, so the only change in the port is `minHeight: 44`. Colours, radius
 * and the on/off treatment are identical.
 *
 * This replaces dropdowns. A `<select>`-shaped control on a phone opens a
 * picker, which is two taps and a dismissal for something that should be one
 * tap on the thing you want.
 */
export function Toggle({ on, onPress, children, tone = "accent", style }: {
  on: boolean;
  onPress: () => void;
  children: ReactNode;
  tone?: "accent" | "warn";
  style?: StyleProp<ViewStyle>;
}) {
  const onStyle = tone === "warn" ? styles.onWarn : styles.onAccent;
  const onText = tone === "warn" ? styles.onWarnText : styles.onAccentText;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      style={({ pressed }) => [
        styles.chip,
        on ? onStyle : styles.off,
        pressed && styles.pressed,
        style,
      ]}
    >
      <Text style={[styles.text, on ? onText : styles.offText]} numberOfLines={1}>
        {children}
      </Text>
    </Pressable>
  );
}

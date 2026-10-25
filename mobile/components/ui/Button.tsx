import { Pressable, StyleSheet, Text } from "react-native";
import type { ReactNode } from "react";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";

import { color, hit, radius, space } from "./tokens";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "hero";

const base = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});

const variants = StyleSheet.create({
  primary: { backgroundColor: color.accent },
  secondary: { backgroundColor: color.surface2, borderWidth: 1, borderColor: color.lineStrong },
  ghost: { backgroundColor: "transparent" },
  danger: { backgroundColor: "transparent", borderWidth: 1, borderColor: color.lineStrong },
});

const labels = StyleSheet.create({
  primary: { color: color.ground, fontWeight: "600" },
  secondary: { color: color.ink, fontWeight: "500" },
  ghost: { color: color.muted, fontWeight: "500" },
  danger: { color: color.bad, fontWeight: "500" },
});

/**
 * Heights are tap targets, not padding.
 *
 * `md` is Apple's 44pt floor and is the most this should ever shrink to. `lg`
 * and `hero` exist because the primary action in a flow gets pressed with
 * chalky hands while out of breath: "LOG SET" is a `hero`.
 *
 * The corner radius grows with the height. 8pt corners — the web's
 * `rounded-lg`, which is right at 40pt tall — look like a mistake on a 72pt
 * block, so the two larger sizes step up to 12.
 */
const sizes: Record<Size, { height: number; radius: number; fontSize: number }> = {
  md: { height: hit.min, radius: radius.md, fontSize: 14 },
  lg: { height: hit.big, radius: radius.lg, fontSize: 16 },
  hero: { height: hit.huge, radius: radius.lg, fontSize: 18 },
};

/**
 * The port of the web's `<Button>`, with native press feedback.
 *
 * Deliberately has no haptic of its own. A button does not know whether it just
 * saved a set, opened a sheet or cancelled something, and those should not feel
 * the same — so the feature calls `tapSelect` / `tapSave` / `tapDone` from
 * `lib/haptics` in its own handler. A haptic baked in here would fire on every
 * press in the app, which is the fastest way to make haptics feel like noise.
 */
export function Button({
  children,
  onPress,
  variant = "primary",
  size = "md",
  disabled = false,
  style,
  textStyle,
}: {
  /**
   * Text, or a `<Text>`. Always wrapped in a styled `Text` so the variant's
   * colour and weight are inherited.
   */
  children: ReactNode;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const s = sizes[size];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        base.button,
        variants[variant],
        { height: s.height, borderRadius: s.radius },
        pressed && base.pressed,
        disabled && base.disabled,
        style,
      ]}
    >
      <Text style={[labels[variant], { fontSize: s.fontSize }, textStyle]} numberOfLines={1}>
        {children}
      </Text>
    </Pressable>
  );
}

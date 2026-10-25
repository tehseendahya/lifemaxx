import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReactNode } from "react";

import { color, radius, space } from "./tokens";
import { useSlideIn } from "./useSlideIn";

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { backgroundColor: "#000000" },
  panel: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: color.line,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: color.lineStrong,
    marginBottom: space.lg,
  },
  title: { color: color.ink, fontSize: 17, fontWeight: "600", marginBottom: space.md },
});

/**
 * A bottom sheet, and the app's only answer to "are you sure?".
 *
 * This replaces every `confirm()` and every `Alert.alert` the web app uses, and
 * every dropdown. An `Alert` is the system interrupting the user; a sheet is the
 * app continuing, in the app's own typeface and colours, with 44pt targets and
 * a swipe-free dismissal by tapping anywhere above it. Nothing a user does on
 * purpose should be confirmed by a system dialog.
 *
 * The backdrop is tappable to close. A sheet that can only be dismissed by its
 * own button is a sheet the user has to aim at.
 */
export function Sheet({ visible, onClose, children, title }: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}) {
  const insets = useSafeAreaInsets();
  const { mounted, onPanelLayout, backdropStyle, panelStyle } = useSlideIn(visible);

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
        </Pressable>

        <Animated.View
          onLayout={onPanelLayout}
          style={[styles.panel, panelStyle, { paddingBottom: insets.bottom + space.lg }]}
        >
          <View style={styles.grabber} />
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

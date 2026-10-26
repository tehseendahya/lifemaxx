import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import type { ReactNode } from "react";

import { PANEL_MAX_WIDTH, useIsWide } from "@/lib/layout";

import { dialogMaxHeight } from "./sheet-size";
import { color, radius, space } from "./tokens";

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", alignItems: "center", padding: space.xxl },
  // A dimming scrim, not a surface colour — the same exception `Sheet` makes.
  backdrop: { backgroundColor: "#000000", opacity: 0.6 },
  panel: {
    width: "100%",
    maxWidth: PANEL_MAX_WIDTH,
    backgroundColor: color.ground,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.xl,
    overflow: "hidden",
  },
});

/**
 * A screen-sized task laid over the app: the exercise picker, typed set entry,
 * the note editor.
 *
 * On the phone this is exactly the `<Modal animationType="slide">` each of
 * those used to open directly — full screen, its own safe area, swipe and back
 * button as before. On a laptop a full-window takeover would hide the sidebar
 * and stretch a search list across 1400px, so it is a tall centred panel over a
 * dimmed backdrop instead. A click on the backdrop and Escape both close it
 * (react-native-web's `Modal` calls `onRequestClose` on Escape).
 *
 * The children are the same in both cases and lay themselves out to fill what
 * they are given, which on the laptop is the panel.
 */
export function Overlay({ visible, onRequestClose, children, statusBarTranslucent }: {
  visible: boolean;
  onRequestClose: () => void;
  children: ReactNode;
  statusBarTranslucent?: boolean;
}) {
  const wide = useIsWide();
  const { height } = useWindowDimensions();

  if (!wide) {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        onRequestClose={onRequestClose}
        statusBarTranslucent={statusBarTranslucent}
      >
        {children}
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <View style={styles.root}>
        <Pressable
          style={[StyleSheet.absoluteFill, styles.backdrop]}
          onPress={onRequestClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={[styles.panel, { height: dialogMaxHeight(height) }]}>{children}</View>
      </View>
    </Modal>
  );
}

import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReactNode } from "react";

import { CONTENT_MAX_WIDTH, useIsWide } from "@/lib/layout";

import { SCROLL_BOTTOM_INSET, color, space } from "./tokens";

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.ground },
  gutter: { paddingHorizontal: space.lg },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.md,
    marginBottom: space.xl,
  },
  title: {
    color: color.ink,
    fontSize: 24,
    fontWeight: "600",
    // The port of `tracking-tight`. Negative tracking on a 24pt semibold title
    // is most of what makes it read as a heading rather than as large body.
    letterSpacing: -0.4,
  },
  subtitle: { color: color.muted, fontSize: 13, marginTop: space.xs, lineHeight: 18 },
  body: { flex: 1 },

  /**
   * The opaque strip the status bar sits on.
   *
   * The scroll variant's top inset is `contentContainerStyle` padding, which
   * positions the content on first paint and then does nothing: scroll it and
   * the content travels up through the inset and renders *behind* the clock and
   * the battery, which have no background of their own. On the owner's phone
   * that read as "Barbell Bench Press" colliding with 11:36 and "144 lb"
   * colliding with the time.
   *
   * So the inset is also painted. A sibling of the `ScrollView` rather than a
   * header inside it, because it must not scroll and must not consume layout —
   * the padding already reserves the space, and this only covers it.
   *
   * `pointerEvents="none"` so a tap near the top of the screen still reaches
   * whatever is under it, and ground rather than a blur: this app is dark-only,
   * `expo-glass-effect` would make a 20pt strip the one thing on the phone that
   * needs a native module, and an opaque strip cannot fail to load.
   */
  statusCover: { position: "absolute", left: 0, right: 0, top: 0, backgroundColor: color.ground },

  /**
   * The laptop column: centred, capped, and with more air than a phone's
   * 16pt gutter. `width: "100%"` is what lets `maxWidth` bite inside a scroll
   * container, whose content otherwise sizes to its children.
   */
  wide: {
    width: "100%",
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: "center",
    paddingHorizontal: space.xxl + space.sm,
  },
});

/**
 * The top padding on a laptop, where there is no status bar to clear and the
 * title should not sit flush against the top of the window.
 */
const WIDE_TOP = 40;

/**
 * Every screen's frame: safe-area padding, the title block, and the scroll
 * container.
 *
 * The navigators deliberately run with `headerShown: false` — the web app's
 * headers carry a subtitle and an action, which a native header cannot express
 * without fighting it — so the top inset is this component's job and no screen
 * should add its own.
 *
 * There is no `wide` prop: the laptop layout is decided by the window, not by
 * the screen. On a wide browser window the content becomes a centred column
 * capped at `CONTENT_MAX_WIDTH`, and the screens that have independent cards
 * lay them out in two with `Columns`. A phone is one column, as before.
 */
export function Screen({
  title,
  subtitle,
  action,
  children,
  scroll = true,
  refreshing = false,
  onRefresh,
}: {
  title: string;
  /**
   * Text, or a `<Text>` element for the live cases (an elapsed-time counter, a
   * `tnum` figure). It is always wrapped in a styled `Text`, mirroring the
   * web's `<p className="text-sm text-muted">`, so a nested `<Text>` inherits
   * the muted colour and only overrides what it means to. Do not pass a
   * `<View>` — React Native cannot lay one out inside text.
   */
  subtitle?: ReactNode;
  /** Right-aligned on the title row. A `Button`, usually. */
  action?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const wide = useIsWide();
  const top = wide ? WIDE_TOP : insets.top + space.md;

  const header = (
    <View style={styles.header}>
      <View style={{ flexShrink: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle !== undefined && subtitle !== null && (
          <Text style={styles.subtitle}>{subtitle}</Text>
        )}
      </View>
      {action}
    </View>
  );

  if (!scroll) {
    return (
      <View style={[styles.root, styles.gutter, wide && styles.wide, { paddingTop: top }]}>
        {header}
        {/*
          No bottom inset on the fixed variant. This is for screens that pin
          something to the bottom themselves — the live session and its logging
          bar — and they need the full height to position it against.
        */}
        <View style={styles.body}>{children}</View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[
          styles.gutter,
          wide && styles.wide,
          {
            paddingTop: top,
            paddingBottom: SCROLL_BOTTOM_INSET + insets.bottom,
          },
        ]}
        // The insets above are computed here; letting iOS also apply its own
        // would double the top gap on a notched phone.
        contentInsetAdjustmentBehavior="never"
        // So that tapping a button while the coach's keyboard is up acts on the
        // button instead of being swallowed by the dismiss.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          onRefresh
            ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.muted} />
            : undefined
        }
      >
        {header}
        {children}
      </ScrollView>

      {/*
        Last child, so it paints over the scrolled content. Zero-height on a
        device with no top inset, where there is nothing to cover.
      */}
      <View pointerEvents="none" style={[styles.statusCover, { height: insets.top }]} />
    </View>
  );
}

import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReactNode } from "react";

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
});

/**
 * Every screen's frame: safe-area padding, the title block, and the scroll
 * container.
 *
 * The navigators deliberately run with `headerShown: false` — the web app's
 * headers carry a subtitle and an action, which a native header cannot express
 * without fighting it — so the top inset is this component's job and no screen
 * should add its own.
 *
 * There is no `wide` prop. The web's two-column variant was a laptop
 * affordance; a phone is one column.
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
      <View style={[styles.root, styles.gutter, { paddingTop: insets.top + space.md }]}>
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
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.gutter,
        { paddingTop: insets.top + space.md, paddingBottom: SCROLL_BOTTOM_INSET + insets.bottom },
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
  );
}

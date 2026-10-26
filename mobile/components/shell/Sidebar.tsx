import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePathname, useRouter } from "expo-router";

import { color, font, radius, space } from "@/components/ui/tokens";
import { NAV_ITEMS, SIDEBAR_WIDTH, activeNav, navMove, type NavItem } from "@/lib/layout";

const styles = StyleSheet.create({
  root: {
    width: SIDEBAR_WIDTH,
    backgroundColor: color.surface,
    borderRightWidth: 1,
    borderRightColor: color.line,
    paddingHorizontal: space.md,
    paddingTop: space.xxl,
  },
  brand: {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: color.muted,
    paddingHorizontal: space.md,
    marginBottom: space.xxl,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    height: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    marginBottom: 2,
  },
  itemHover: { backgroundColor: color.surface2 },
  itemOn: { backgroundColor: color.accentSoft },
  glyph: { width: 20, textAlign: "center", fontSize: 16, color: color.muted },
  label: { fontSize: 14, fontWeight: "500", color: color.ink },
  on: { color: color.accentInk },
});

/**
 * The laptop's navigation: six places down the left, where the phone has four
 * tabs along the bottom.
 *
 * It is mounted by the root layout, around the whole stack, rather than as a
 * custom tab bar. That is what lets Runs and Coach be places here without
 * touching the phone: on the phone they are a pushed screen and a modal, and
 * they stay exactly that — the same `/runs` and `/coach` routes, which this
 * sidebar simply navigates to. A tab-bar sidebar would only reach the four
 * tabs, and adding Runs and Coach as tabs would have given them a second route
 * each, or moved them out of the phone's stack.
 *
 * The hover state is drawn explicitly rather than left to the global hover
 * rule in `lib/web-styles.ts`: nav items are plain text on the surface, where a
 * brightness filter has nothing to brighten.
 */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const active = activeNav(pathname);

  const go = (item: NavItem) => {
    const move = navMove(pathname, item);
    if (move === "none") return;
    if (move === "replace") router.replace(item.href);
    else router.navigate(item.href);
  };

  return (
    <View style={styles.root} role="navigation">
      <Text style={styles.brand}>lifemaxx</Text>
      {NAV_ITEMS.map((item) => {
        const on = item.key === active;
        return (
          <Pressable
            key={item.key}
            onPress={() => go(item)}
            accessibilityRole="link"
            accessibilityState={{ selected: on }}
            accessibilityLabel={item.label}
            style={(state) => [
              styles.item,
              // `hovered` is react-native-web's, and not in React Native's
              // types — the native app never renders this component.
              (state as { hovered?: boolean }).hovered && !on && styles.itemHover,
              on && styles.itemOn,
            ]}
          >
            <Text style={[styles.glyph, on && styles.on]}>{item.glyph}</Text>
            <Text style={[styles.label, on && styles.on]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

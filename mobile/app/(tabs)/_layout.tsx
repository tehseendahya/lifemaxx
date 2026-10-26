import { Text, type ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { shell, microLabel } from "@/lib/shell-theme";
import { useIsWide } from "@/lib/layout";

/**
 * Four tabs, not the web app's six — on the phone. A laptop window gets the
 * sidebar in `components/shell/Sidebar.tsx` instead, with all six.
 *
 * Six items in a 390pt bar is 65pt per target, and it gives the screen you open
 * mid-set the same room as the one you look at once a week. Runs are read-only
 * data you review (they reach the Today card and a pushed screen); the coach is
 * a task, not a place (a modal from the Today header, plus the in-session ASK
 * control, which is a different endpoint). Dropping both buys Lift 25% of the
 * bar instead of 16%.
 *
 * The icons are glyph characters in `<Text>` rather than an icon font: they are
 * the same marks the web nav uses, they need no asset pipeline, and an icon
 * font that fails to load is a row of empty boxes at the bottom of the screen.
 */
export default function TabsLayout() {
  // On a laptop the root layout draws a sidebar with all six places, and a
  // bottom bar with four of them underneath it would be a second, worse nav.
  const wide = useIsWide();

  return (
    <Tabs
      // Not rendered at all rather than styled away, so it reserves no height.
      tabBar={wide ? () => null : undefined}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: shell.accent,
        tabBarInactiveTintColor: shell.muted,
        tabBarStyle: {
          backgroundColor: shell.surface,
          borderTopColor: shell.line,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: microLabel,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Today", tabBarIcon: icon("◎") }} />
      <Tabs.Screen name="lift" options={{ title: "Lift", tabBarIcon: icon("▮") }} />
      <Tabs.Screen name="food" options={{ title: "Food", tabBarIcon: icon("◍") }} />
      <Tabs.Screen name="you" options={{ title: "You", tabBarIcon: icon("○") }} />
    </Tabs>
  );
}

function icon(glyph: string) {
  // `color` is a ColorValue, not a string — it is nullable, which is why the
  // obvious `{ color: string }` annotation does not typecheck here.
  return ({ color }: { color: ColorValue }) => (
    <Text style={{ color, fontSize: 20, lineHeight: 24 }}>{glyph}</Text>
  );
}

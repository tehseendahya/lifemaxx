import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { shell, microLabel } from "./shell-theme";

/**
 * A stand-in screen body, so the route tree bundles and navigates before the
 * feature workstreams land.
 *
 * Every one of these is replaced by a real screen: each route file in `app/`
 * has a single marked import and a single marked element to swap. When the last
 * one is gone, delete this file.
 */
export function Placeholder({ title, note }: { title: string; note: string }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: shell.ground, paddingTop: insets.top + 24, paddingHorizontal: 16 }}>
      <Text style={{ ...microLabel, color: shell.muted, marginBottom: 6 }}>Not built yet</Text>
      <Text style={{ color: shell.ink, fontSize: 28, fontWeight: "600", marginBottom: 10 }}>{title}</Text>
      <Text style={{ color: shell.muted, fontSize: 14, lineHeight: 20 }}>{note}</Text>
    </View>
  );
}

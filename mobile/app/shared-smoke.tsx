import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { displayLb, platesPerSide, lbToKg } from "@/lib/shared/units";
import { newClientId, backoffMs, MAX_ATTEMPTS } from "@/lib/shared/outbox";
import { epley } from "@/lib/shared/e1rm";
import { formatPace, weekStartOf } from "@/lib/shared/running";
import { WEEKLY_SET_TARGET } from "@/lib/shared/muscles";
import { shell, microLabel } from "@/lib/shell-theme";

/**
 * A diagnostic, not a feature. Keep it.
 *
 * Everything on this screen comes from `src/lib/` — outside the Expo project
 * root, resolved only because `metro.config.js` watches `../src/lib` and the
 * barrels in `lib/shared/` re-export it by relative path. That is the single
 * most load-bearing and least obvious piece of this setup, and it fails in two
 * quite different ways: at bundle time (Metro cannot resolve the path, caught
 * by `npx expo export`) or at runtime on the device (it resolves to a second
 * copy, or a type-only import was not elided and dragged `drizzle-orm` into the
 * bundle).
 *
 * The second kind cannot be caught in CI, so this route exists to answer it in
 * five seconds on a phone: if the numbers below are right, the shared domain
 * layer is live in Expo Go. Reachable at /shared-smoke — not linked from
 * anywhere, because it is for whoever is debugging, not for the user.
 */
export default function SharedSmoke() {
  const insets = useSafeAreaInsets();

  const rows: [string, string][] = [
    ["displayLb(100) kg→lb", String(displayLb(100))],
    ["lbToKg(45)", lbToKg(45).toFixed(4)],
    ["platesPerSide(lbToKg(225))", platesPerSide(lbToKg(225)).map((p) => displayLb(p)).join(" / ")],
    ["epley(100, 5)", epley(100, 5).toFixed(2)],
    ["formatPace(522)", formatPace(522)],
    ["weekStartOf('2026-10-25')", weekStartOf("2026-10-25")],
    ["WEEKLY_SET_TARGET", `${WEEKLY_SET_TARGET.min}–${WEEKLY_SET_TARGET.max}`],
    ["backoffMs(3) / MAX_ATTEMPTS", `${backoffMs(3)} / ${MAX_ATTEMPTS}`],
    ["newClientId()", newClientId()],
  ];

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: shell.ground,
        paddingTop: insets.top + 24,
        paddingHorizontal: 16,
      }}
    >
      <Text style={{ ...microLabel, color: shell.muted }}>Diagnostic</Text>
      <Text style={{ color: shell.ink, fontSize: 24, fontWeight: "600", marginTop: 6, marginBottom: 4 }}>
        Shared domain layer
      </Text>
      <Text style={{ color: shell.muted, fontSize: 13, marginBottom: 20, lineHeight: 19 }}>
        Imported from ../src/lib across the project boundary. If these render,
        Metro resolved it and Expo Go is running it.
      </Text>

      {rows.map(([label, value]) => (
        <View
          key={label}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingVertical: 9,
            borderBottomWidth: 1,
            borderBottomColor: shell.line,
            gap: 12,
          }}
        >
          <Text style={{ color: shell.muted, fontSize: 12, fontFamily: "Menlo", flexShrink: 1 }}>
            {label}
          </Text>
          <Text
            style={{
              color: shell.ink,
              fontSize: 13,
              fontFamily: "Menlo",
              // Every figure in this app is tabular, without exception — a
              // column of numbers that jitters as it updates is the most
              // visible possible regression from the web app.
              fontVariant: ["tabular-nums"],
            }}
            numberOfLines={1}
          >
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, tnum } from "./tokens";

const TRACK_HEIGHT = 6;

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  label: { color: color.muted, fontSize: 14 },
  figure: { ...tnum, color: color.ink, fontSize: 14, fontWeight: "500" },
  target: { color: color.muted, fontWeight: "400" },
  track: {
    height: TRACK_HEIGHT,
    marginTop: space.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: color.surface2,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: radius.pill },
});

/**
 * A macro ring, done as a bar — ported unchanged from the web.
 *
 * Rings look nice and read badly. The only question anyone asks of this number
 * is "how far over or under", and a bar answers it at a glance from across a
 * kitchen.
 *
 * The percentage is capped at 150 while the drawn width is capped at 100: the
 * cap on the width is what stops the fill escaping the track, and the separate
 * cap on the percentage is what keeps a 400%-of-target protein day from making
 * the arithmetic meaningless. Over 105% the fill turns `warn` regardless of
 * `tone`, so being over shows up as a colour change rather than as a bar that
 * is merely full.
 */
export function MacroBar({ label, value, target, unit = "g", tone = "accent" }: {
  label: string;
  value: number;
  target?: number | null;
  unit?: string;
  tone?: "accent" | "good" | "warn";
}) {
  const pct = target && target > 0 ? Math.min(150, (value / target) * 100) : 0;
  const over = target ? value > target * 1.05 : false;
  const fill = over ? color.warn : tone === "good" ? color.good : tone === "warn" ? color.warn : color.accent;

  return (
    <View>
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.figure}>
          {Math.round(value)}{unit}
          {target ? <Text style={styles.target}> / {Math.round(target)}{unit}</Text> : null}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(100, pct)}%`, backgroundColor: fill }]} />
      </View>
    </View>
  );
}

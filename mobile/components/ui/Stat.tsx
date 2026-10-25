import { StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";

import { microLabel } from "./Label";
import { color, space, tnum } from "./tokens";

const styles = StyleSheet.create({
  label: microLabel,
  value: { ...tnum, color: color.ink, fontSize: 20, fontWeight: "600", marginTop: 2 },
  hint: { color: color.muted, fontSize: 11, marginTop: 2 },
});

/**
 * A labelled figure — the port of the web's `<Stat>`.
 *
 * The value is wrapped in a `tnum` `Text`, so passing a string gets tabular
 * numerals for free and passing a `<Text>` inherits them. Never render a figure
 * on this app's surfaces without them: these appear in rows that update live,
 * and proportional digits make the row twitch sideways on every change.
 *
 * Its label does not use `Label`: the web sets this one 2pt above the figure
 * rather than 8, because a stat is one unit and a card's heading is not.
 */
export function Stat({ label, value, hint }: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

import { Pressable, StyleSheet, Text, View } from "react-native";

import { Label, Pill, color, space } from "@/components/ui";
import { tapSelect } from "@/lib/haptics";
import { pillParts, type DisplaySet } from "./logic";

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs },
  pressed: { opacity: 0.6 },
  rpe: { color: color.muted },
  failure: { color: color.warn },
  empty: { color: color.muted, fontSize: 13 },
});

/**
 * Today's sets for the exercise on screen.
 *
 * Read-only, and deliberately so: the card above is where sets are made, and a
 * row of editable chips under it would turn a glance into a decision. The one
 * thing a pill can do is be removed, and that is a long-press into a sheet
 * rather than a swipe or an x — a 28pt delete target next to the thumb that
 * presses LOG seventy times a session is how a set gets deleted by accident.
 *
 * A dashed, 70%-opacity pill means the set is on this phone and not yet on the
 * server. Same treatment as the web app, and deliberately quiet: being in a
 * basement is the normal case here, not an error state.
 */
export function SetPills({
  sets,
  onLongPressSet,
}: {
  sets: DisplaySet[];
  onLongPressSet: (set: DisplaySet) => void;
}) {
  return (
    <View>
      <Label>Today</Label>
      {sets.length === 0 ? (
        <Text style={styles.empty}>No sets yet.</Text>
      ) : (
        <View style={styles.wrap}>
          {sets.map((set) => {
            const parts = pillParts(set);
            return (
              <Pressable
                key={set.key}
                onLongPress={() => {
                  tapSelect();
                  onLongPressSet(set);
                }}
                delayLongPress={350}
                accessibilityRole="button"
                accessibilityLabel={`${parts.main}${parts.rpe ?? ""}, long press to remove`}
                accessibilityHint="Long press to remove this set"
                style={({ pressed }) => (pressed ? styles.pressed : undefined)}
              >
                <Pill variant={set.isWarmup ? "warmup" : set.queued ? "queued" : "default"}>
                  {parts.main}
                  {parts.rpe !== null && <Text style={styles.rpe}>{parts.rpe}</Text>}
                  {parts.failure && <Text style={styles.failure}> F</Text>}
                </Pill>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

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
 * ── A TAP OPENS THE FIX SHEET ──────────────────────────────────────────────
 *
 * This was read-only, deliberately: the card above is where sets are made, and
 * the only thing a chip could do was be removed — on a LONG press, so that a
 * thumb pressing the 72pt LOG button seventy times a session could not destroy
 * a set by brushing a 28pt chip.
 *
 * The owner asked for the obvious missing half of that: *"should be able to
 * click into a set below and edit smtg if you typed it in wrong"*. So a plain
 * tap now opens `EditSetSheet`, which writes nothing until SAVE and carries the
 * REMOVE button that used to be the whole interaction. A press that costs a
 * dismissal needs no gesture to protect it, and a hidden gesture is no good to
 * someone who does not know it is there — the chips never said they could be
 * long-pressed.
 *
 * A dashed, 70%-opacity pill means the set is on this phone and not yet on the
 * server. Same treatment as the web app, and deliberately quiet: being in a
 * basement is the normal case here, not an error state.
 */
export function SetPills({
  sets,
  onPressSet,
}: {
  sets: DisplaySet[];
  onPressSet: (set: DisplaySet) => void;
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
                onPress={() => {
                  tapSelect();
                  onPressSet(set);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${parts.main}${parts.rpe ?? ""}`}
                accessibilityHint="Opens this set to be fixed or removed"
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

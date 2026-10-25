import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, space, tnum } from "@/components/ui";
import { microLabel } from "@/components/ui/Label";
import { tapSelect } from "@/lib/haptics";
import { restLabel } from "./logic";
import type { RestTimer } from "./useRestTimer";

/** The visible bar. Three points, as specified — it is a readout, not a widget. */
const BAR_H = 3;

const styles = StyleSheet.create({
  // The bar is 3pt; the press target is the whole 26pt strip. A 3pt tap target
  // would be unhittable, and this one is pressed with a thumb while out of
  // breath.
  root: { paddingTop: space.sm },
  row: { flexDirection: "row", justifyContent: "flex-end", paddingBottom: 3 },
  label: { ...microLabel, ...tnum, marginBottom: 0 },
  labelDone: { color: color.accent },
  track: { height: BAR_H, backgroundColor: color.line, borderRadius: BAR_H },
  fill: { height: BAR_H, backgroundColor: color.lineStrong, borderRadius: BAR_H },
  fillDone: { backgroundColor: color.accent, width: "100%" },
  pressed: { opacity: 0.6 },
});

/**
 * The rest timer: a bar above the tab bar, and nothing else.
 *
 * Every rest timer that is a modal, a sheet or a full-screen countdown has the
 * same flaw — it is in the way at the exact moment the user wants to look at
 * the set they just logged, change the weight, or swipe to the next exercise.
 * This one occupies three points of height, blocks nothing, intercepts nothing,
 * and can be ignored entirely.
 *
 * Tap dismisses it. Long-press restarts it, which is the "I got distracted"
 * case and is deliberately the harder of the two gestures, because dismissing
 * by accident costs nothing and restarting by accident costs two minutes of
 * wrong information.
 */
export function RestTimerBar({ timer }: { timer: RestTimer }) {
  const { remainingS, done, progress } = timer;
  if (remainingS === null && !done) return null;

  return (
    <Pressable
      onPress={() => {
        tapSelect();
        timer.dismiss();
      }}
      onLongPress={() => {
        tapSelect();
        timer.start();
      }}
      delayLongPress={350}
      accessibilityRole="timer"
      accessibilityLabel={
        done ? "Rest finished" : `${restLabel(remainingS ?? 0)} of rest remaining`
      }
      accessibilityHint="Tap to dismiss, long press to restart"
      style={({ pressed }) => [styles.root, pressed && styles.pressed]}
    >
      <View style={styles.row}>
        <Text style={[styles.label, done && styles.labelDone]}>
          {done ? "REST DONE" : restLabel(remainingS ?? 0)}
        </Text>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            done
              ? styles.fillDone
              : { width: `${Math.min(100, Math.max(0, progress * 100))}%` },
          ]}
        />
      </View>
    </Pressable>
  );
}

import { Pressable, StyleSheet, Text, View } from "react-native";

import { Toggle, color, hit, radius, space, tnum } from "@/components/ui";
import { microLabel } from "@/components/ui/Label";
import { tapSelect } from "@/lib/haptics";
import { exerciseChip, fmtWeight, heardLine, type LogRow, type PadField, type RowPatch } from "./model";

const styles = StyleSheet.create({
  root: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.lg,
    backgroundColor: color.surface2,
    padding: space.md,
    marginBottom: space.sm,
  },
  rootBad: { borderColor: color.bad },

  chip: { minHeight: hit.min, justifyContent: "center" },
  chipPressed: { opacity: 0.6 },
  chipText: { color: color.ink, fontSize: 15, fontWeight: "500" },
  chipFuzzy: { color: color.warn },
  chipBad: { color: color.bad, fontSize: 13 },
  heard: { ...microLabel, marginBottom: 0, marginTop: 2 },

  figures: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm },
  figure: {
    minWidth: 86,
    minHeight: hit.min,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  figurePressed: { backgroundColor: color.line },
  figureValue: { ...tnum, color: color.ink, fontSize: 18, fontWeight: "600" },
  figureUnit: { color: color.muted, fontSize: 12 },

  spacer: { flex: 1 },
  icon: {
    width: hit.min,
    height: hit.min,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  iconPressed: { backgroundColor: color.line },
  iconText: { color: color.muted, fontSize: 20 },
  iconTextDanger: { color: color.bad },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
});

/**
 * One set, editable.
 *
 * One row per SET rather than per exercise is the whole reason this component
 * exists. "3 sets of 6" that came back as 2 is fixed with one tap on `⧉`; a
 * row that should not be there goes with one tap on `×`. Neither requires
 * retyping the sentence, which is the failure the user actually complained
 * about — too many taps for a correction.
 *
 * Every figure is a `Pressable` that opens the same `NumberPad` the manual hero
 * flow uses. There is no `TextInput` on this row: a numeric keyboard here would
 * cost a focus round trip per field and shove the sheet up and down.
 */
export function SetRow({
  row,
  index,
  onOpenPad,
  onPatch,
  onDuplicate,
  onDelete,
  onPickExercise,
}: {
  row: LogRow;
  /** 1-based, for the accessibility label only. The sets are not numbered on screen. */
  index: number;
  onOpenPad: (key: string, field: PadField) => void;
  onPatch: (key: string, patch: RowPatch) => void;
  onDuplicate: (key: string) => void;
  onDelete: (key: string) => void;
  onPickExercise: (entryKey: string, query: string) => void;
}) {
  const chip = exerciseChip(row);
  const heard = heardLine(row);

  return (
    <View style={[styles.root, chip.tone === "bad" && styles.rootBad]}>
      {/*
        The chip is always a button, including when the match was exact. A
        correct match the user cannot change is a trap the first time the
        catalogue disagrees with them, and the target costs nothing.
      */}
      <Pressable
        onPress={() => {
          tapSelect();
          onPickExercise(row.entryKey, row.query);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Set ${index}: ${row.exerciseName ?? row.query}. Tap to change the exercise.`}
        style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
      >
        <Text
          style={[
            styles.chipText,
            chip.tone === "fuzzy" && styles.chipFuzzy,
            chip.tone === "bad" && styles.chipBad,
          ]}
          numberOfLines={2}
        >
          {chip.text}
        </Text>
        {heard !== null && <Text style={styles.heard}>{heard}</Text>}
      </Pressable>

      <View style={styles.figures}>
        <Figure
          value={fmtWeight(row.weightLb)}
          unit="lb"
          label={`Set ${index} weight`}
          onPress={() => onOpenPad(row.key, "weight")}
        />
        <Figure
          value={`× ${row.reps}`}
          unit="reps"
          label={`Set ${index} reps`}
          onPress={() => onOpenPad(row.key, "reps")}
        />

        <View style={styles.spacer} />

        <Pressable
          onPress={() => {
            tapSelect();
            onDuplicate(row.key);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Duplicate set ${index}`}
          hitSlop={8}
          style={({ pressed }) => [styles.icon, pressed && styles.iconPressed]}
        >
          <Text style={styles.iconText}>⧉</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            tapSelect();
            onDelete(row.key);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Remove set ${index}`}
          hitSlop={8}
          style={({ pressed }) => [styles.icon, pressed && styles.iconPressed]}
        >
          <Text style={[styles.iconText, styles.iconTextDanger]}>×</Text>
        </Pressable>
      </View>

      <View style={styles.chips}>
        {/*
          RPE opens the pad rather than cycling through values on tap. It is a
          number, and the app has exactly one way to type a number; a chip that
          cycles 6→7→8→9→10→off costs up to five taps to reach 7 from 8.
        */}
        <Toggle on={row.rpe !== null} onPress={() => onOpenPad(row.key, "rpe")}>
          {row.rpe !== null ? `RPE ${row.rpe}` : "RPE"}
        </Toggle>
        <Toggle
          on={row.toFailure}
          tone="warn"
          onPress={() => {
            tapSelect();
            onPatch(row.key, { toFailure: !row.toFailure });
          }}
        >
          TO FAILURE
        </Toggle>
        <Toggle
          on={row.isWarmup}
          onPress={() => {
            tapSelect();
            onPatch(row.key, { isWarmup: !row.isWarmup });
          }}
        >
          WARMUP
        </Toggle>
      </View>
    </View>
  );
}

function Figure({
  value,
  unit,
  label,
  onPress,
}: {
  value: string;
  unit: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.figure, pressed && styles.figurePressed]}
    >
      <Text style={styles.figureValue}>{value}</Text>
      <Text style={styles.figureUnit}>{unit}</Text>
    </Pressable>
  );
}

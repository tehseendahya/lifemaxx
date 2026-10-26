import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button, Segmented, Sheet, color, hit, radius, space, tnum } from "@/components/ui";
import type { Segment } from "@/components/ui";
import { microLabel } from "@/components/ui/Label";
import { tapSelect } from "@/lib/haptics";
import {
  RPE_CHOICES,
  kindPatch,
  leadingWarmups,
  rpeLabel,
  type RowPatch,
  type SetGroup,
  type SetKind,
} from "./model";

/**
 * A value no segment holds, so the control draws nothing as selected.
 *
 * The honest state for "these fifteen sets do not agree about RPE" is no
 * selection at all. Showing the first set's 8 would be a claim about the other
 * fourteen, and showing `—` would claim they have no RPE.
 */
const NOTHING_SELECTED = -1;

const styles = StyleSheet.create({
  block: { marginBottom: space.lg },
  label: { ...microLabel, marginBottom: space.sm },

  stepperRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  step: {
    width: hit.min,
    height: hit.min,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: color.lineStrong,
    borderRadius: radius.md,
    backgroundColor: color.surface2,
  },
  stepPressed: { backgroundColor: color.line },
  stepDisabled: { opacity: 0.4 },
  stepText: { color: color.ink, fontSize: 20, fontWeight: "600" },
  count: { ...tnum, color: color.ink, fontSize: 20, fontWeight: "600", minWidth: 28, textAlign: "center" },
  countNote: { color: color.muted, fontSize: 13, flex: 1 },

  action: { marginBottom: space.sm },
  danger: { marginTop: space.sm },
});

/**
 * Typed as nullable so the control can render with NOTHING selected. These
 * three are instructions ("make them all warmups"), not a readout of a state
 * that may not exist — a group of mixed kinds has no single answer to show.
 */
const KIND_SEGMENTS: readonly Segment<SetKind | null>[] = [
  { value: "warmup", label: "ALL WARMUP", tone: "muted" },
  { value: "working", label: "ALL WORKING", tone: "accent" },
  { value: "failure", label: "ALL TO FAILURE", tone: "warn" },
];

/**
 * Everything you can do to a whole exercise at once.
 *
 * Fifteen sets in one paste is the normal case for this owner, not an edge
 * case, so per-set tapping cannot be the only path: "all of those were at RPE
 * 8" is one decision and it has to cost one or two taps, not fifteen. The
 * per-line controls stay for the set that differs.
 *
 * Nothing in here needs a second confirmation, DELETE ALL included. The sheet
 * writes nothing until the footer is tapped — DISCARD is the undo, and it is
 * always on screen behind this one.
 */
export function GroupActions({
  group,
  cue,
  onClose,
  onPatchGroup,
  onFirstWarmups,
  onNoteForAll,
  onEditCue,
  onPickExercise,
  onDeleteGroup,
}: {
  /** `null` while nothing is open; the sheet animates out on the way to it. */
  group: SetGroup | null;
  /** This lift's carry-forward cue, or `null`. Changes the button's wording only. */
  cue: string | null;
  onClose: () => void;
  onPatchGroup: (entryKey: string, patch: RowPatch) => void;
  onFirstWarmups: (entryKey: string, k: number) => void;
  onNoteForAll: (entryKey: string) => void;
  onEditCue: (exerciseId: string, exerciseName: string) => void;
  onPickExercise: (entryKey: string, query: string) => void;
  onDeleteGroup: (entryKey: string) => void;
}) {
  // Kept mounted with no content between opens so `Sheet`'s exit animation can
  // run; `visible={group !== null}` drives it and the body is only read while
  // it is open.
  const n = group?.rows.length ?? 0;
  const name = group?.exerciseName ?? group?.query ?? "";

  /**
   * The stepper's value is DERIVED, not stored.
   *
   * `markFirstWarmups` applies on every tap, so the number of leading warmups
   * in the rows *is* the stepper's position. A local `useState` beside it would
   * be a second copy of the same number, and the two drift the moment a set is
   * deleted underneath this sheet.
   */
  const warmups = group === null ? 0 : leadingWarmups(group.rows);

  /** Something to pin a cue to, or `null`. See the button below. */
  const cuable = group !== null && group.exerciseId !== null && group.exerciseName !== null
    ? { id: group.exerciseId, name: group.exerciseName }
    : null;

  const common = (() => {
    if (group === null || group.rows.length === 0) return NOTHING_SELECTED;
    const first = group.rows[0].rpe;
    return group.rows.every((row) => row.rpe === first) ? first : NOTHING_SELECTED;
  })();

  return (
    <Sheet
      visible={group !== null}
      onClose={onClose}
      title={group === null ? "" : `${name} · ${n} set${n === 1 ? "" : "s"}`}
    >
      {group !== null && (
        <>
          <View style={styles.block}>
            <Text style={styles.label}>{`SET RPE FOR ALL ${n} SETS`}</Text>
            <Segmented
              options={RPE_CHOICES.map((value) => ({ value, label: rpeLabel(value) }))}
              value={common}
              numeric
              accessibilityLabel={`RPE for all ${n} sets`}
              onSelect={(value) => {
                tapSelect();
                onPatchGroup(group.entryKey, { rpe: value === NOTHING_SELECTED ? null : value });
                onClose();
              }}
            />
          </View>

          <View style={styles.block}>
            <Text style={styles.label}>EVERY SET IS</Text>
            <Segmented
              options={KIND_SEGMENTS}
              // Deliberately nothing selected: this row is an instruction, not
              // a readout. A group of mixed kinds has no single answer, and the
              // per-line badges are where the current state is legible.
              value={null as SetKind | null}
              micro
              accessibilityLabel={`Mark all ${n} sets`}
              onSelect={(kind) => {
                tapSelect();
                if (kind === null) return;
                onPatchGroup(group.entryKey, kindPatch(kind));
                onClose();
              }}
            />
          </View>

          <View style={styles.block}>
            <Text style={styles.label}>{`FIRST ${warmups} ARE WARMUPS`}</Text>
            <View style={styles.stepperRow}>
              <Step
                glyph="−"
                label="One fewer warmup"
                disabled={warmups === 0}
                onPress={() => onFirstWarmups(group.entryKey, warmups - 1)}
              />
              <Text style={styles.count}>{warmups}</Text>
              <Step
                glyph="+"
                label="One more warmup"
                disabled={warmups >= n}
                onPress={() => onFirstWarmups(group.entryKey, warmups + 1)}
              />
              {/*
                The stepper stays open and applies on every tap. Warmups are a
                run at the start of an exercise, so the useful interaction is
                "one more, one more, that's it" with the lines visible behind
                this sheet — not a value chosen blind and committed.
              */}
              <Text style={styles.countNote}>
                {warmups === 0 ? "All working sets." : `The other ${n - warmups} are working sets.`}
              </Text>
            </View>
          </View>

          <Button
            variant="secondary"
            style={styles.action}
            onPress={() => {
              tapSelect();
              onNoteForAll(group.entryKey);
            }}
          >
            {`NOTE FOR ALL ${n} SETS`}
          </Button>

          {/*
            Directly under the note button, because the two are the pair the
            owner has to tell apart: the note above goes on these sets in this
            session, and the cue here goes on the LIFT and comes back every
            time. Side by side, the wording of the two buttons is the
            explanation — "for all N sets" against "to this lift".

            Absent, not disabled, when nothing has resolved: a cue needs an
            exercise id to be pinned to, and `CHANGE EXERCISE` below is what
            that group needs first.
          */}
          {cuable !== null && (
            <Button
              variant="secondary"
              style={styles.action}
              onPress={() => {
                tapSelect();
                onEditCue(cuable.id, cuable.name);
              }}
            >
              {cue === null ? "PIN A CUE TO THIS LIFT" : "EDIT THE CUE ON THIS LIFT"}
            </Button>
          )}

          <Button
            variant="secondary"
            style={styles.action}
            onPress={() => {
              tapSelect();
              onPickExercise(group.entryKey, group.query);
            }}
          >
            CHANGE EXERCISE
          </Button>

          <Button
            variant="danger"
            style={styles.danger}
            onPress={() => {
              tapSelect();
              onDeleteGroup(group.entryKey);
            }}
          >
            {`DELETE ALL ${n} SETS`}
          </Button>
        </>
      )}
    </Sheet>
  );
}

function Step({
  glyph,
  label,
  disabled,
  onPress,
}: {
  glyph: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        tapSelect();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.step,
        pressed && styles.stepPressed,
        disabled && styles.stepDisabled,
      ]}
    >
      <Text style={styles.stepText}>{glyph}</Text>
    </Pressable>
  );
}

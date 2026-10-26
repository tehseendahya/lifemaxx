import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button, Card, Label, Segmented, Toggle, color, hit, radius, space, tnum } from "@/components/ui";
import type { Segment } from "@/components/ui";
import { microLabel } from "@/components/ui/Label";
import { tapSelect } from "@/lib/haptics";
import { useIsWide } from "@/lib/layout";
import { KIND_LABEL, SET_KINDS, kindFlags, setKindOf, type SetKind } from "@/lib/set-kind";
import { lbToKg, platesPerSide } from "@/lib/shared/units";
import type { LastSet } from "@/lib/types";
import {
  fmtWeight,
  heroLabel,
  lastLine,
  type Draft,
  type Entry,
  type PagerExercise,
  type SuggestPair,
} from "./logic";
import { parseTypedReps, parseTypedWeight } from "./typed-entry";

/** The RPE values that mean anything in practice. Below 6 is a warmup. */
const RPE_SCALE = [6, 7, 8, 9, 10] as const;

const FELT = [
  { key: "weak", label: "WEAK" },
  { key: "normal", label: "NORMAL" },
  { key: "strong", label: "STRONG" },
] as const;

/**
 * Warmup, working and to failure, as one control.
 *
 * Same three tones the confirmation sheet uses, from the same `KIND_LABEL`, so
 * a warmup looks like a warmup on both screens. Working is the accent because
 * it is the answer that is true for most of a session and the one the card
 * returns to after every save.
 */
const KIND_TONE: Record<SetKind, "accent" | "warn" | "muted"> = {
  warmup: "muted",
  working: "accent",
  failure: "warn",
};

const KIND_SEGMENTS: readonly Segment<SetKind>[] = SET_KINDS.map((kind) => ({
  value: kind,
  label: KIND_LABEL[kind],
  tone: KIND_TONE[kind],
}));

const styles = StyleSheet.create({
  name: { color: color.ink, fontSize: 20, fontWeight: "600", letterSpacing: -0.2 },
  last: { ...microLabel, ...tnum, marginTop: space.xs },

  hero: { marginTop: space.lg },

  advice: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  adviceBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  adviceBoxModel: { borderColor: color.accent, backgroundColor: color.accentSoft },
  adviceFigure: { ...tnum, color: color.muted, fontSize: 13, fontWeight: "500" },
  adviceFigureModel: { color: color.accentInk },
  adviceReason: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },

  stepperRow: { flexDirection: "row", gap: space.sm, marginTop: space.lg },
  stepper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.lg,
    backgroundColor: color.surface2,
    overflow: "hidden",
  },
  stepKey: { width: hit.big, height: hit.big, alignItems: "center", justifyContent: "center" },
  stepKeyText: { color: color.ink, fontSize: 24, fontWeight: "500" },
  stepValue: { flex: 1, height: hit.big, alignItems: "center", justifyContent: "center" },
  stepValueText: { ...tnum, color: color.ink, fontSize: 18, fontWeight: "600" },
  stepValueUnit: { color: color.muted, fontSize: 12, fontWeight: "400" },
  stepValuePlaceholder: { color: color.muted },
  /** The laptop's typed figure: the same face as the button it replaces. */
  stepInput: {
    ...tnum,
    color: color.ink,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    width: "100%",
    height: hit.big,
    padding: 0,
  },
  stepInputRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.xs },
  pressed: { opacity: 0.6, backgroundColor: color.surface },

  plates: { ...microLabel, ...tnum, marginTop: space.sm },

  kind: { marginTop: space.lg },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
  rpeRow: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
  rpeChip: { flex: 1, paddingHorizontal: 0 },

  note: {
    marginTop: space.sm,
    minHeight: hit.min,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    backgroundColor: color.surface2,
    paddingHorizontal: space.md,
    color: color.ink,
    fontSize: 14,
  },
});

/*
 * Not wrapped in `memo`. Every prop it takes that is a function is an inline
 * closure over the session's state, so a memo here would never bail out — it
 * would only advertise an optimisation that does not exist.
 */
export function ExerciseCard({
  exercise,
  history,
  today,
  entry,
  draft,
  suggest,
  focused,
  onDraft,
  onLog,
  onOpenPad,
  onRequestSuggest,
  onStepWeight,
  onStepReps,
  onTypeWeight,
  onTypeReps,
  onToggleRpe,
  rpeOpen,
  noteOpen,
  onToggleNote,
}: {
  exercise: PagerExercise;
  history: LastSet | undefined;
  today: string;
  entry: Entry;
  draft: Draft;
  suggest: SuggestPair | null;
  /** True when this is the page under the thumb. Only the focused page asks for advice. */
  focused: boolean;
  onDraft: (patch: Partial<Draft>) => void;
  onLog: () => void;
  onOpenPad: (field: "weight" | "reps") => void;
  onRequestSuggest: (exerciseId: string) => void;
  onStepWeight: (dir: 1 | -1) => void;
  onStepReps: (dir: 1 | -1) => void;
  /** A typed weight, in lb, from the laptop's field. Never called on the phone. */
  onTypeWeight: (lb: number) => void;
  /** Typed reps, from the laptop's field. Never called on the phone. */
  onTypeReps: (reps: number) => void;
  onToggleRpe: () => void;
  rpeOpen: boolean;
  noteOpen: boolean;
  onToggleNote: () => void;
}) {
  useEffect(() => {
    if (focused) onRequestSuggest(exercise.id);
  }, [focused, exercise.id, onRequestSuggest]);

  // On a laptop the two figures are typed fields: Tab from weight to reps,
  // Enter logs. On the phone they open the pad, as they always have.
  const wide = useIsWide();

  return (
    <Card>
      <Text style={styles.name} numberOfLines={2}>
        {exercise.name}
      </Text>
      <Text style={styles.last}>{lastLine(history, today)}</Text>

      {/*
        The one control that matters. It is labelled with the set it will write,
        it is 72pt tall, and one tap on it is a logged set — no confirmation, no
        field to fill, no network to wait for. Everything else on this card
        exists to change what this button says.
      */}
      <Button size="hero" onPress={onLog} style={styles.hero}>
        {heroLabel(entry, draft.isWarmup)}
      </Button>

      {suggest !== null && <Advice suggest={suggest} />}

      <View style={styles.stepperRow}>
        <Stepper
          value={entry.weightLb}
          unit="lb"
          onDown={() => onStepWeight(-1)}
          onUp={() => onStepWeight(1)}
          onTapValue={() => onOpenPad("weight")}
          typed={wide ? { parse: parseTypedWeight, onValue: onTypeWeight, onSubmit: onLog, decimal: true } : null}
          accessibilityLabel="Weight"
        />
        <Stepper
          value={entry.reps}
          unit="reps"
          onDown={() => onStepReps(-1)}
          onUp={() => onStepReps(1)}
          onTapValue={() => onOpenPad("reps")}
          typed={wide ? { parse: parseTypedReps, onValue: onTypeReps, onSubmit: onLog, decimal: false } : null}
          accessibilityLabel="Reps"
        />
      </View>

      <Plates equipment={exercise.equipment} weightLb={entry.weightLb} />

      {/*
        One question with three answers, not two switches.

        These were two `<Toggle>` pills — WARMUP and TO FAILURE — and nothing
        stopped both being on at once. The owner sent a screenshot of exactly
        that and said it should be "one or the other", which it now is by
        construction: `kindFlags` writes BOTH columns on every tap, so the pair
        cannot come apart. It is also the control the confirmation sheet has
        always used for the same two flags; see `lib/set-kind.ts`.
      */}
      <View style={styles.kind}>
        <Segmented
          micro
          options={KIND_SEGMENTS}
          value={setKindOf(draft)}
          onSelect={(kind) => {
            tapSelect();
            onDraft(kindFlags(kind));
          }}
          accessibilityLabel="Set kind"
        />
      </View>

      <View style={styles.chips}>
        <Toggle on={rpeOpen || draft.rpe !== null} onPress={onToggleRpe}>
          {draft.rpe !== null ? `RPE ${draft.rpe}` : "RPE"}
        </Toggle>
        {FELT.map((f) => (
          <Toggle
            key={f.key}
            on={draft.felt === f.key}
            onPress={() => {
              tapSelect();
              // Mutually exclusive, and tapping the active one clears it —
              // there is no "none of these" chip to aim at.
              onDraft({ felt: draft.felt === f.key ? null : f.key });
            }}
          >
            {f.label}
          </Toggle>
        ))}
        <Toggle on={noteOpen || draft.note !== ""} onPress={onToggleNote}>
          NOTE
        </Toggle>
      </View>

      {rpeOpen && (
        <View style={styles.rpeRow}>
          {RPE_SCALE.map((r) => (
            <Toggle
              key={r}
              style={styles.rpeChip}
              on={draft.rpe === r}
              onPress={() => {
                tapSelect();
                onDraft({ rpe: draft.rpe === r ? null : r });
              }}
            >
              {r}
            </Toggle>
          ))}
        </View>
      )}

      {noteOpen && (
        <TextInput
          style={styles.note}
          value={draft.note}
          onChangeText={(note) => onDraft({ note })}
          placeholder="left shoulder pinched on set 3"
          placeholderTextColor={color.muted}
          returnKeyType="done"
          autoFocus
          // The only system keyboard in this flow, and collapsed by default
          // because it costs a 250ms animation and reflows everything under it.
          // `blurOnSubmit` so DONE puts it away without a second tap elsewhere.
          blurOnSubmit
        />
      )}
    </Card>
  );
}

/**
 * The rule's number next to the model's, with both reasons.
 *
 * Ported from `src/components/SetLogger.tsx` on purpose, including the
 * side-by-side framing: when the model deviates from the mechanical baseline
 * the user has to be able to see it deviating and read why. That is what keeps
 * a suggestion engine trustworthy in month six rather than only in week one.
 */
function Advice({ suggest }: { suggest: SuggestPair }) {
  const { baseline, suggestion } = suggest;

  return (
    <View style={styles.advice}>
      <View style={styles.adviceBox}>
        <Label>Rule</Label>
        <Text style={styles.adviceFigure}>
          {fmtWeight(baseline.weightLb)} × {baseline.reps} × {baseline.sets}
        </Text>
        <Text style={styles.adviceReason} numberOfLines={3}>
          {baseline.reason}
        </Text>
      </View>

      {suggestion !== null && (
        <View style={[styles.adviceBox, styles.adviceBoxModel]}>
          <Label>Coach</Label>
          <Text style={[styles.adviceFigure, styles.adviceFigureModel]}>
            {fmtWeight(suggestion.weightLb)} × {suggestion.reps} × {suggestion.sets}
          </Text>
          <Text style={styles.adviceReason} numberOfLines={3}>
            {suggestion.reason}
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * `−  185 lb  +`, with the number itself as a third target.
 *
 * Three tap zones in one 56pt row: step down, step up, and type an arbitrary
 * value. Tapping the figure is what keeps "I'm doing 227.5 today" to six taps
 * without putting a text field on a card that is otherwise all buttons.
 *
 * On a laptop (`typed` set) the figure IS a text field, and the two step keys
 * leave the Tab order so that Tab goes straight from weight to reps.
 */
function Stepper({
  value,
  unit,
  onDown,
  onUp,
  onTapValue,
  typed,
  accessibilityLabel,
}: {
  value: number | null;
  unit: string;
  onDown: () => void;
  onUp: () => void;
  onTapValue: () => void;
  typed: TypedField | null;
  accessibilityLabel: string;
}) {
  // react-native-web reads `tabIndex` off a Pressable; native ignores it.
  const offTabOrder = typed !== null ? { tabIndex: -1 as const } : null;

  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={onDown}
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel} down`}
        style={({ pressed }) => [styles.stepKey, pressed && styles.pressed]}
        {...offTabOrder}
      >
        <Text style={styles.stepKeyText}>−</Text>
      </Pressable>

      {typed !== null ? (
        <TypedValue value={value} unit={unit} field={typed} label={accessibilityLabel} />
      ) : (
        <Pressable
          onPress={onTapValue}
          accessibilityRole="button"
          accessibilityLabel={`Set ${accessibilityLabel.toLowerCase()}`}
          style={({ pressed }) => [styles.stepValue, pressed && styles.pressed]}
        >
          <Text style={styles.stepValueText}>
            {value === null ? (
              <Text style={styles.stepValuePlaceholder}>—</Text>
            ) : (
              fmtWeight(value)
            )}
            <Text style={styles.stepValueUnit}> {unit}</Text>
          </Text>
        </Pressable>
      )}

      <Pressable
        onPress={onUp}
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel} up`}
        style={({ pressed }) => [styles.stepKey, pressed && styles.pressed]}
        {...offTabOrder}
      >
        <Text style={styles.stepKeyText}>+</Text>
      </Pressable>
    </View>
  );
}

interface TypedField {
  /** Text to a figure, or null while the text is not one yet. See `typed-entry.ts`. */
  parse: (text: string) => number | null;
  onValue: (value: number) => void;
  /** Enter: log the set the hero button now says. */
  onSubmit: () => void;
  decimal: boolean;
}

/**
 * The laptop's typed figure.
 *
 * Every keystroke that reads as a figure goes straight into the draft, so the
 * hero button says `LOG 185 × 5` while you are still typing and Enter logs
 * exactly that — there is no separate commit step to forget. Text that is not
 * a figure yet ("", "2" on the way to "20kg") leaves the draft alone.
 *
 * The field owns its text only while it has focus. Otherwise it shows the
 * entry, so a step key, a logged set or a late suggestion all redraw it, and
 * leaving the field tidies "20kg" into the 44.1 lb it was read as.
 */
function TypedValue({ value, unit, field, label }: {
  value: number | null;
  unit: string;
  field: TypedField;
  label: string;
}) {
  const shown = value === null ? "" : fmtWeight(value);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);

  return (
    <View style={[styles.stepValue, styles.stepInputRow]}>
      <TextInput
        value={text}
        onChangeText={(next) => {
          setText(next);
          const parsed = field.parse(next);
          if (parsed !== null) field.onValue(parsed);
        }}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onSubmitEditing={field.onSubmit}
        // Selecting on focus is the pad's "the first digit replaces the
        // prefill", in the browser's own terms.
        selectTextOnFocus
        inputMode={field.decimal ? "decimal" : "numeric"}
        placeholder="—"
        placeholderTextColor={color.muted}
        accessibilityLabel={label}
        style={styles.stepInput}
      />
      <Text style={styles.stepValueUnit}>{unit}</Text>
    </View>
  );
}

/**
 * What to hang on each side of the bar.
 *
 * Zero taps and one line, and it answers the question that actually follows
 * "log 227.5": what do I load. `platesPerSide` is the shared domain function
 * the web app uses — storage is kg, the rack is in lb, and the conversion
 * happens once inside it rather than here.
 *
 * Barbell only. A dumbbell has no plates and a cable stack is already labelled.
 */
function Plates({ equipment, weightLb }: { equipment: string; weightLb: number | null }) {
  if (equipment !== "barbell" || weightLb === null) return null;

  const plates = platesPerSide(lbToKg(weightLb));
  if (plates.length === 0) return null;

  return <Text style={styles.plates}>PER SIDE {plates.map(fmtWeight).join(" · ")}</Text>;
}

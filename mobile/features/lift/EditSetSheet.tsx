import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  Button,
  Label,
  NumberPad,
  Segmented,
  Sheet,
  color,
  hit,
  radius,
  space,
  tnum,
} from "@/components/ui";
import type { Segment } from "@/components/ui";
import {
  WEIGHT_UNITS,
  enteredWeightToLb,
  equivalentLabel,
  lbToEnteredWeight,
  type WeightUnit,
} from "@/components/ui/weight-entry";
import { tapError, tapSave, tapSelect } from "@/lib/haptics";
import { KIND_LABEL, SET_KINDS, type SetKind } from "@/lib/set-kind";

import {
  editBlockedReason,
  editChanged,
  editFromSet,
  fmtWeight,
  numberToPad,
  padToNumber,
  type DisplaySet,
  type SetEdit,
} from "./logic";

const styles = StyleSheet.create({
  figures: { flexDirection: "row", gap: space.sm, marginBottom: space.lg },
  figure: {
    flex: 1,
    minHeight: hit.big,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.lg,
    backgroundColor: color.surface2,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    justifyContent: "center",
  },
  figureText: { ...tnum, color: color.ink, fontSize: 22, fontWeight: "600" },
  figureUnit: { color: color.muted, fontSize: 13, fontWeight: "400" },
  pressed: { opacity: 0.6 },

  group: { marginBottom: space.lg },

  /** What this write will do, in one muted line. */
  fate: { color: color.muted, fontSize: 12, lineHeight: 18, marginBottom: space.lg },
  error: { color: color.bad, fontSize: 13, lineHeight: 19, marginBottom: space.md },

  secondary: { marginTop: space.sm },
  remove: { marginTop: space.lg },
  /** The second-press line above REMOVE, when removing ends the workout. */
  warning: {
    color: color.ink, fontSize: 14, lineHeight: 20, marginTop: space.lg, marginBottom: space.md,
  },
});

const RPE_SEGMENTS: readonly Segment<number | null>[] = [
  { value: null, label: "—" },
  { value: 6, label: "6" },
  { value: 7, label: "7" },
  { value: 8, label: "8" },
  { value: 9, label: "9" },
  { value: 10, label: "10" },
];

/** Same three tones the confirmation sheet uses, so a warmup looks alike on both. */
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

type Pad = "weight" | "reps" | null;

/**
 * Fixing a set that is already logged.
 *
 * The owner's words: *"should be able to click into a set below and edit smtg
 * if you typed it in wrong"*. A chip under the card used to be long-press →
 * REMOVE or KEEP IT, so a weight typed as 155 instead of 165 cost a delete and
 * a full re-log — which also moved the set to the end of the session and lost
 * whatever note went with it. How the correction reaches the server, and why it
 * is a re-POST rather than a PATCH, is in `logic.ts` under "fixing a set".
 *
 * ── A TAP, NOT A LONG PRESS ────────────────────────────────────────────────
 *
 * `SetPills` reserved the long press for removal, deliberately, so a thumb that
 * presses the 72pt LOG button seventy times a session could not delete a set by
 * brushing a 28pt chip. That reasoning held while the only thing a chip could do
 * was be destroyed. It does not hold now: a tap opens this sheet, which writes
 * nothing until SAVE, and the destructive button is a labelled 44pt target at
 * the bottom of a sheet the user opened on purpose.
 *
 * ── THE NUMBER PAD OVER A SHEET ────────────────────────────────────────────
 *
 * Both are `Modal`s and this file renders them as siblings, which is the shape
 * `QuickLog` has used since the confirmation sheet shipped — every figure on a
 * set line there opens the same pad over the same kind of sheet. It is only one
 * pad deep and it closes back to this sheet, not to the screen.
 *
 * Weight and reps are TYPED, not stepped. A stepper is for progressive loading
 * — "same as last time plus five" — and that is the card's job. This is the
 * mistyped-figure path, so each figure is a tap target that opens the pad, in
 * whichever unit the card was last typing in for this exercise.
 *
 * ── TWO MODES ──────────────────────────────────────────────────────────────
 *
 * The past-workout screen reuses this sheet for both of its set editors, so a
 * figure is typed the same way everywhere. `mode="edit"` (the default, and the
 * only mode the live session uses) fixes an existing set. `mode="add"` is
 * "+ Add set" on a finished workout: the sheet opens on a prefill dressed as a
 * set (see `features/workout/model.ts`), titled "Add a set", savable without a
 * change because the prefill IS the set being added, and with no REMOVE —
 * there is nothing yet to remove.
 */
export function EditSetSheet({
  set,
  unit,
  onUnitChange,
  error,
  onSave,
  onRemove,
  onClose,
  mode = "edit",
  removeWarning = null,
  pending = false,
}: {
  /** The set being fixed. `null` closes the sheet. */
  set: DisplaySet | null;
  unit: WeightUnit;
  onUnitChange: (next: WeightUnit) => void;
  /** Whatever the last save or remove failed with. `""` is no error. */
  error: string;
  onSave: (edit: SetEdit) => void;
  onRemove: () => void;
  onClose: () => void;
  mode?: "edit" | "add";
  /**
   * When removing this set does more than remove a set — the past-workout
   * screen's last set, whose removal deletes the workout. REMOVE then asks
   * twice: the first press shows this sentence, the second does it.
   */
  removeWarning?: string | null;
  /**
   * A direct request is in flight (the past-workout screen; the live session
   * queues and never waits). Buttons hold still so a second press cannot send
   * a second write.
   */
  pending?: boolean;
}) {
  const [edit, setEdit] = useState<SetEdit | null>(null);
  const [pad, setPad] = useState<Pad>(null);
  const [padValue, setPadValue] = useState("");
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  /*
   * Seeded from the set's KEY, not from the set itself.
   *
   * The merged list is rebuilt on every tick of the session clock and on every
   * refetch, so `set` is a fresh object constantly; depending on it would
   * re-seed mid-edit and throw away what the user had typed. The key is stable
   * across the queued → delivered transition by design — that is what it is
   * for — so this re-seeds exactly when a different set is opened, and not
   * otherwise.
   */
  const key = set?.key ?? null;
  useEffect(() => {
    setPad(null);
    setPadValue("");
    setConfirmingRemove(false);
    // `set` is read here and deliberately not a dependency; `key` stands in
    // for it. There is no eslint in this project to tell about that, so this
    // comment is the only thing stopping someone adding `set` back.
    setEdit(set === null ? null : editFromSet(set));
  }, [key]);

  const commitPad = () => {
    tapSave();
    const value = padToNumber(padValue);
    // `null` means the pad was closed untouched, which must leave the figure
    // alone rather than writing 0 — the distinction `NumberPad` exists to keep.
    if (value !== null && pad !== null && edit !== null) {
      setEdit(
        pad === "weight"
          // Full precision, like the card's pad: storage is kg, and a kg entry
          // only round-trips exactly if nothing rounds here.
          ? { ...edit, weightLb: enteredWeightToLb(value, unit) }
          // Clamped rather than refused: a set with no reps is not a set, and
          // `editBlockedReason` would otherwise block SAVE on a stray `0`.
          : { ...edit, reps: Math.max(1, Math.round(value)) },
      );
    }
    setPad(null);
    setPadValue("");
  };

  return (
    <>
      {/*
        Rendered unconditionally with a `visible` prop, like every other sheet
        in this app: `Sheet` plays its own exit animation, which it cannot do if
        the parent stops rendering it the moment the set goes away.
      */}
      <Sheet
        visible={set !== null}
        onClose={onClose}
        title={mode === "add" ? "Add a set" : "Fix this set"}
      >
        {set !== null && edit !== null ? (
          <Body
            set={set}
            edit={edit}
            unit={unit}
            error={error}
            mode={mode}
            pending={pending}
            removeWarning={confirmingRemove ? removeWarning : null}
            onPatch={(patch) => setEdit({ ...edit, ...patch })}
            onOpenPad={(field) => {
              tapSelect();
              setPadValue(
                numberToPad(
                  field === "weight" ? lbToEnteredWeight(edit.weightLb, unit) : edit.reps,
                ),
              );
              setPad(field);
            }}
            onSave={() => onSave(edit)}
            onRemove={() => {
              // Two presses only when the removal takes the workout with it.
              if (removeWarning !== null && !confirmingRemove) {
                tapSelect();
                setConfirmingRemove(true);
                return;
              }
              onRemove();
            }}
            onClose={onClose}
          />
        ) : null}
      </Sheet>

      <NumberPad
        visible={pad !== null}
        value={padValue}
        label={pad === "reps" ? "Reps" : "Weight"}
        unit={pad === "reps" ? "reps" : unit}
        allowDecimal={pad !== "reps"}
        units={
          pad === "weight"
            ? {
                options: WEIGHT_UNITS,
                value: unit,
                onChange: (next) => {
                  tapSelect();
                  // Relabel, never rescale. See `weight-entry.ts`.
                  onUnitChange(next as WeightUnit);
                },
              }
            : undefined
        }
        equivalent={pad === "weight" ? equivalentLabel(padToNumber(padValue), unit) : null}
        onChange={(next) => {
          tapSelect();
          setPadValue(next);
        }}
        onDone={commitPad}
        onCancel={() => {
          setPad(null);
          setPadValue("");
        }}
      />
    </>
  );
}

/**
 * The sheet's contents, with a set and an edit that are both certainly there.
 *
 * Split out only so the narrowing happens once, at the call site, instead of in
 * front of every figure and every handler.
 */
function Body({
  set,
  edit,
  unit,
  error,
  mode,
  pending,
  removeWarning,
  onPatch,
  onOpenPad,
  onSave,
  onRemove,
  onClose,
}: {
  set: DisplaySet;
  edit: SetEdit;
  unit: WeightUnit;
  error: string;
  mode: "edit" | "add";
  pending: boolean;
  /** Shown above REMOVE once it has been pressed and needs a second press. */
  removeWarning: string | null;
  onPatch: (patch: Partial<SetEdit>) => void;
  onOpenPad: (field: "weight" | "reps") => void;
  onSave: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const blocked = editBlockedReason(edit);
  const adding = mode === "add";
  // An added set has nothing to differ from: the prefill is a proposal, and
  // accepting it unchanged is the common case (a fourth set of 185 × 5).
  const dirty = adding || editChanged(set, edit);
  const canSave = blocked === null && dirty && !pending;

  const saveLabel = adding
    ? (pending ? "ADDING…" : "ADD SET")
    : pending ? "SAVING…" : dirty ? "SAVE THE FIX" : "NOTHING CHANGED";

  return (
    <>
      {error !== "" && <Text style={styles.error}>{error}</Text>}

      <View style={styles.figures}>
        <Figure
          label="Weight"
          value={fmtWeight(lbToEnteredWeight(edit.weightLb, unit))}
          unit={unit}
          onPress={() => onOpenPad("weight")}
        />
        <Figure
          label="Reps"
          value={String(edit.reps)}
          unit="reps"
          onPress={() => onOpenPad("reps")}
        />
      </View>

      <View style={styles.group}>
        <Label>RPE</Label>
        <Segmented
          numeric
          options={RPE_SEGMENTS}
          value={edit.rpe}
          onSelect={(rpe) => {
            tapSelect();
            onPatch({ rpe });
          }}
          accessibilityLabel="RPE"
        />
      </View>

      <View style={styles.group}>
        <Label>Kind</Label>
        {/*
          One question with three answers, and the same control the card above
          now uses. See `lib/set-kind.ts`: both write BOTH flags, so a set
          cannot come out of here marked warmup AND to failure.
        */}
        <Segmented
          micro
          options={KIND_SEGMENTS}
          value={edit.kind}
          onSelect={(kind) => {
            tapSelect();
            onPatch({ kind });
          }}
          accessibilityLabel="Set kind"
        />
      </View>

      {blocked !== null ? (
        <Text style={styles.error}>{blocked}</Text>
      ) : (
        <Text style={styles.fate}>
          {adding
            ? "Added after the last set in this workout."
            : set.id === null
              ? "This set has not reached the server yet, so the fix replaces the write that is still waiting."
              : "The set keeps its place in the session — only the figures change."}
        </Text>
      )}

      <Button
        size="lg"
        onPress={() => {
          if (!canSave) {
            tapError();
            return;
          }
          onSave();
        }}
        disabled={!canSave}
      >
        {saveLabel}
      </Button>

      <Button variant="ghost" style={styles.secondary} onPress={onClose} disabled={pending}>
        CANCEL
      </Button>

      {!adding && (
        <>
          {removeWarning !== null && <Text style={styles.warning}>{removeWarning}</Text>}
          <Button
            variant="danger"
            style={removeWarning === null ? styles.remove : undefined}
            onPress={onRemove}
            disabled={pending}
          >
            {removeWarning !== null ? "REMOVE AND DELETE WORKOUT" : "REMOVE THIS SET"}
          </Button>
        </>
      )}
    </>
  );
}

/** One tappable figure with its unit, sized like the card's stepper. */
function Figure({
  label,
  value,
  unit,
  onPress,
}: {
  label: string;
  value: string;
  unit: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value} ${unit}`}
      style={({ pressed }) => [styles.figure, pressed && styles.pressed]}
    >
      <Label>{label}</Label>
      <Text style={styles.figureText}>
        {value}
        <Text style={styles.figureUnit}> {unit}</Text>
      </Text>
    </Pressable>
  );
}

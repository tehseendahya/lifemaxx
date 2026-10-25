import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, tnum } from "@/components/ui";
import { microLabel } from "@/components/ui/Label";
import { tapSelect } from "@/lib/haptics";
import { Segmented } from "./Segmented";
import type { Segment } from "./Segmented";
import {
  fmtWeight,
  implausible,
  kindPatch,
  offendingField,
  rpeChoices,
  rpeLabel,
  setKind,
  type LogRow,
  type PadField,
  type RowPatch,
  type SetKind,
} from "./model";

/** One set is one 56pt line. Fifteen of them is a list, not fifteen cards. */
export const LINE_HEIGHT = 56;

/**
 * Column widths, which have to add up — and the arithmetic is the reason they
 * are these numbers rather than rounder ones.
 *
 * 70 + 54 + 30 + 32 + 30 + 44 + 44 = **304pt**. The tightest case in the app is
 * a 360pt-wide phone (iPhone 12/13 mini) showing a *marked* group: 360 − 32 for
 * the sheet's gutters − 12 for the group's left border inset = 316pt. That
 * leaves 12pt for the flexible spacer, and the line cannot overflow. A fixed
 * 2pt gap between all seven children would have cost 14pt and clipped the
 * delete button off the right edge of that phone, which is the sort of thing
 * that is invisible until someone holds one.
 *
 * They are fixed rather than flexed so that fifteen lines form actual columns:
 * a weight that shifts left because the reps beside it went from 5 to 12 is the
 * same jitter tabular numerals exist to prevent, one level up.
 *
 * The three narrow affordances are under 44pt wide and carry `hitSlop` to clear
 * the floor — the rule is about what a thumb can hit, not what is painted, and
 * the 56pt line height already gives them the other axis.
 */
const W = { weight: 70, reps: 54, kind: 30, rpe: 32, note: 30, icon: 44 } as const;

const styles = StyleSheet.create({
  root: { borderBottomWidth: 1, borderBottomColor: color.line },

  // No `gap`: the flexible spacer between the figures and the controls is the
  // only separation, so the fixed columns can never add up to more than the
  // line is wide. See `W`.
  line: {
    height: LINE_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
  },

  // Two levels, because the two alignments are on different axes: the outer box
  // centres the pair vertically in the 56pt line, and the inner row puts the
  // unit on the figure's baseline rather than on its centre.
  figure: { height: LINE_HEIGHT, justifyContent: "center" },
  figureInner: { flexDirection: "row", alignItems: "baseline", gap: 3 },
  figurePressed: { opacity: 0.55 },
  value: { ...tnum, color: color.ink, fontSize: 18, fontWeight: "600" },
  valueBad: { color: color.bad },
  unit: { ...microLabel, marginBottom: 0, color: color.muted },

  spacer: { flex: 1 },

  /**
   * 30pt wide and 56pt tall, with horizontal `hitSlop` taking the effective
   * target past the 44pt floor. A 44pt-wide badge here would cost 14pt that the
   * weight column needs more, and the rule is about what the thumb can hit, not
   * what is painted.
   */
  badge: {
    width: W.kind,
    height: LINE_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeBox: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeBoxOpen: { borderColor: color.lineStrong, backgroundColor: color.surface2 },
  badgeWarmup: { borderColor: color.lineStrong },
  badgeFailure: { borderColor: color.warn },
  badgeText: { ...tnum, fontSize: 13, fontWeight: "600", color: color.muted },
  badgeTextFailure: { color: color.warn },

  rpe: { width: W.rpe, height: LINE_HEIGHT, alignItems: "center", justifyContent: "center" },
  rpeText: { ...tnum, color: color.accentInk, fontSize: 15, fontWeight: "500" },
  rpeTextBad: { color: color.bad },
  /**
   * The unset states of RPE and the note are faint PLACEHOLDERS rather than
   * nothing at all.
   *
   * Drawing nothing would leave two 30pt tap targets with no indication that
   * they are there, and an RPE you can only change once you already have one
   * is not a control. `lineStrong` is the dimmest token that still reads as
   * type on `surface`, so the line stays quiet with fifteen of them stacked up
   * and the affordance is still findable.
   */
  rpeEmpty: { ...microLabel, marginBottom: 0, color: color.lineStrong },

  note: { width: W.note, height: LINE_HEIGHT, alignItems: "center", justifyContent: "center" },
  noteOn: { color: color.accent, fontSize: 15 },
  noteOff: { color: color.lineStrong, fontSize: 15 },

  icon: {
    width: W.icon,
    height: LINE_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  iconPressed: { opacity: 0.55 },
  iconText: { color: color.muted, fontSize: 20 },
  iconDanger: { color: color.bad },

  impossible: { ...microLabel, marginBottom: 0, color: color.bad, flex: 1, marginLeft: space.sm },

  expander: { paddingBottom: space.sm },
  expanderLabel: { ...microLabel, marginBottom: space.xs },
});

const KIND_SEGMENTS: readonly Segment<SetKind>[] = [
  { value: "warmup", label: "WARMUP", tone: "muted" },
  { value: "working", label: "WORKING", tone: "accent" },
  { value: "failure", label: "FAILURE", tone: "warn" },
];

/** Which inline control is expanded under a line, if any. */
export type LineControl = "rpe" | "kind";

/**
 * One set, as a line rather than a card.
 *
 * The owner's five-line paste produced fifteen bordered boxes, most of them
 * identical, and the structure was the complaint: the unit of the old sheet was
 * a set and the unit of their thinking is an exercise. So the exercise moved up
 * into `GroupHeader` and what is left here is the four figures that actually
 * differ between sets — 56pt, no border, no background, separated by a hairline.
 * Fifteen of these is 840pt of ordinary scrollable list.
 *
 * Every figure is a `Pressable` that opens the same `NumberPad` the manual hero
 * flow uses. There is no `TextInput` for a number anywhere in this app.
 *
 * RPE and set kind expand a `<Segmented>` BENEATH the line, pushing the
 * following lines down, rather than opening a modal over it. Two reasons: the
 * answer set is small and visible, and an overlay would hide the one row the
 * user is answering about. Only one is open at a time in the whole sheet, which
 * is what keeps the list height predictable while scrolling fifteen rows — the
 * parent owns that, not this component.
 */
export function SetLine({
  row,
  index,
  exerciseName,
  open,
  onOpen,
  onOpenPad,
  onPatch,
  onOpenNote,
  onDuplicate,
  onDelete,
}: {
  row: LogRow;
  /** 1-based within its group, for the accessibility labels only. */
  index: number;
  /** For the accessibility labels; the name itself is drawn once, in the header. */
  exerciseName: string;
  open: LineControl | null;
  /** `null` collapses. The parent enforces one-at-a-time across every line. */
  onOpen: (control: LineControl | null) => void;
  onOpenPad: (key: string, field: PadField) => void;
  onPatch: (key: string, patch: RowPatch) => void;
  onOpenNote: (key: string) => void;
  onDuplicate: (key: string) => void;
  onDelete: (key: string) => void;
}) {
  const bad = implausible(row);
  const offending = offendingField(row);
  const kind = setKind(row);
  const where = `set ${index} of ${exerciseName}`;

  return (
    <View style={styles.root}>
      <View style={styles.line}>
        <Pressable
          onPress={() => onOpenPad(row.key, "weight")}
          accessibilityRole="button"
          accessibilityLabel={`${fmtWeight(row.weightLb)} pounds, ${where}. Tap to change.`}
          style={({ pressed }) => [styles.figure, { width: W.weight }, pressed && styles.figurePressed]}
        >
          <View style={styles.figureInner}>
            <Text style={[styles.value, offending === "weight" && styles.valueBad]}>
              {fmtWeight(row.weightLb)}
            </Text>
            <Text style={styles.unit}>lb</Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => onOpenPad(row.key, "reps")}
          accessibilityRole="button"
          accessibilityLabel={`${row.reps} reps, ${where}. Tap to change.`}
          style={({ pressed }) => [styles.figure, { width: W.reps }, pressed && styles.figurePressed]}
        >
          <View style={styles.figureInner}>
            <Text style={[styles.value, offending === "reps" && styles.valueBad]}>
              {`× ${row.reps}`}
            </Text>
          </View>
        </Pressable>

        {bad !== null ? (
          /*
            A blocked line gives its remaining width to the reason. The kind,
            RPE and note controls are not what matters on a row that cannot be
            logged — the fix is almost always the `×` beside it, because the
            owner's `165,5` typo produced one bogus row immediately followed by
            the correct one, so deleting it IS the whole correction.
          */
          <Text style={styles.impossible} numberOfLines={1}>
            ✕ IMPOSSIBLE
          </Text>
        ) : (
          <>
            <View style={styles.spacer} />

            <Pressable
              onPress={() => {
                tapSelect();
                onOpen(open === "kind" ? null : "kind");
              }}
              accessibilityRole="button"
              accessibilityState={{ expanded: open === "kind" }}
              accessibilityLabel={`${kind} ${where}. Tap to change.`}
              hitSlop={{ left: 8, right: 8 }}
              style={styles.badge}
            >
              <View
                style={[
                  styles.badgeBox,
                  kind === "warmup" && styles.badgeWarmup,
                  kind === "failure" && styles.badgeFailure,
                  open === "kind" && styles.badgeBoxOpen,
                ]}
              >
                {/*
                  Two glyphs, not three pills. Warmup and failure are the states
                  worth marking; a working set is the default and says nothing,
                  which is why the badge is empty for it rather than labelled
                  "WORKING" on every one of fifteen lines.
                */}
                <Text style={[styles.badgeText, kind === "failure" && styles.badgeTextFailure]}>
                  {kind === "warmup" ? "W" : kind === "failure" ? "F" : ""}
                </Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() => {
                tapSelect();
                onOpen(open === "rpe" ? null : "rpe");
              }}
              accessibilityRole="button"
              accessibilityState={{ expanded: open === "rpe" }}
              accessibilityLabel={
                row.rpe === null ? `No RPE on ${where}. Tap to set one.` : `RPE ${row.rpe} on ${where}.`
              }
              hitSlop={{ left: 8, right: 8 }}
              style={styles.rpe}
            >
              {row.rpe === null ? (
                <Text style={styles.rpeEmpty}>RPE</Text>
              ) : (
                <Text style={[styles.rpeText, offending === "rpe" && styles.rpeTextBad]}>
                  {`@${row.rpe}`}
                </Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => {
                tapSelect();
                onOpenNote(row.key);
              }}
              accessibilityRole="button"
              accessibilityLabel={
                row.note === "" ? `Add a note to ${where}.` : `Note on ${where}: ${row.note}`
              }
              hitSlop={{ left: 8, right: 8 }}
              style={styles.note}
            >
              {/*
                A dot, not an emoji. `📝` renders at a different size on every
                iOS version and carries a colour this palette does not own; the
                accent dot says "there is something here" in the app's own voice
                and the note itself is one tap away.
              */}
              <Text style={row.note === "" ? styles.noteOff : styles.noteOn}>●</Text>
            </Pressable>
          </>
        )}

        <Pressable
          onPress={() => {
            tapSelect();
            onDuplicate(row.key);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Duplicate ${where}`}
          hitSlop={4}
          style={({ pressed }) => [styles.icon, pressed && styles.iconPressed]}
        >
          <Text style={styles.iconText}>⊕</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            tapSelect();
            onDelete(row.key);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${where}`}
          hitSlop={4}
          style={({ pressed }) => [styles.icon, pressed && styles.iconPressed]}
        >
          <Text style={[styles.iconText, styles.iconDanger]}>×</Text>
        </Pressable>
      </View>

      {open === "rpe" && (
        <View style={styles.expander}>
          <Text style={styles.expanderLabel}>RPE · {`SET ${index}`}</Text>
          <Segmented
            options={rpeChoices(row.rpe).map((value) => ({ value, label: rpeLabel(value) }))}
            value={row.rpe}
            numeric
            accessibilityLabel={`RPE for ${where}`}
            onSelect={(value) => {
              tapSelect();
              // Tapping the selected value clears it. Six segments and no
              // "off" switch would make an RPE impossible to take back, and
              // `—` is itself one of the segments for exactly that reason.
              onPatch(row.key, { rpe: value === row.rpe ? null : value });
              onOpen(null);
            }}
          />
        </View>
      )}

      {open === "kind" && (
        <View style={styles.expander}>
          <Text style={styles.expanderLabel}>{`SET ${index}`}</Text>
          <Segmented
            options={KIND_SEGMENTS}
            value={kind}
            micro
            accessibilityLabel={`Kind of ${where}`}
            onSelect={(next) => {
              tapSelect();
              onPatch(row.key, kindPatch(next));
              onOpen(null);
            }}
          />
        </View>
      )}
    </View>
  );
}

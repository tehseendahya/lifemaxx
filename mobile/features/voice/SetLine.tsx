import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, tnum } from "@/components/ui";
import { microLabel } from "@/components/ui/Label";
import { tapSelect } from "@/lib/haptics";
import { Segmented } from "./Segmented";
import type { Segment } from "./Segmented";
import { ROW_WIDTHS } from "./row-widths";
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
 * ── THE BUG THESE NUMBERS FIX ──────────────────────────────────────────────
 *
 * The owner put RPE 10 on a set and the badge rendered as `@1` on one line and
 * `0` on the next, shoving the controls beside it out of the row. The RPE cell
 * was **32pt**. `@10` in SF at 15pt measures about 31pt — roughly thirteen for
 * the `@` and nine per tabular digit — so the cell was sized to within a point
 * of the widest value the control can produce, and anything that moved that
 * measurement at all pushed it over. React Native scales text with Dynamic
 * Type (`allowFontScaling` defaults to true) and does not
 * scale a `width`, so a cell sized to a glyph's exact measurement is a cell
 * that breaks on the first notch of the iOS text slider. That is the actual
 * defect: not that 32 was one point short, but that every fixed cell here was
 * sized for one text size and the row had no slack to absorb another.
 *
 * So the budget below is computed for the widest LEGAL value in each column at
 * `COMPACT_SCALE_CAP` (1.2×), not at 1.0×:
 *
 *   weight  66  `1500` (MAX_PLAUSIBLE_LB, 4 digits) + `lb` at 1.0× needs 62,
 *               and a 3-digit weight — every real one — needs 61 at 1.2×.
 *   reps    52  `× 50` (MAX_PLAUSIBLE_REPS) needs 50 at 1.2×.
 *   kind    30  one glyph.
 *   rpe     46  and the widest value here is NOT `@10`. `rpeChoices` keeps a
 *               half step the parser produced — `@7.5` is a legal RPE and a
 *               real `sets.rpe` value — so the cell is sized for four glyphs
 *               at 1.2×, not three. Sizing a cell to the exact measurement of
 *               the value you happened to think of is how this broke once
 *               already.
 *   note    30  one dot.
 *   icon    38  ×2, `⊕` and `×`.
 *
 * 66 + 52 + 30 + 46 + 30 + 38 + 38 = **300pt**, and the flexible spacer takes
 * whatever is left. The tightest frame the app has to survive is a 360pt
 * viewport showing a *marked* group: 360 − 32 for the sheet's gutters − 12 for
 * the group's left border inset = 316pt, leaving 16pt of spacer. (360 is an
 * Android width and is narrower than any iPhone this build runs on — the
 * narrowest of those is 375pt, an SE or an 8; the note that used to be here
 * called a 12/13 mini 360pt and it is 375. Designing to 360 anyway costs
 * nothing and the number is no longer load-bearing, since the row now has
 * slack instead of exactly none.)
 *
 * The RPE cell gained 14pt and every point of it was paid for: 6pt from each
 * icon button (44 → 38), 4pt from the weight column and 2pt from reps, both of
 * which were sized past anything they can legally hold. The row got 4pt
 * narrower overall, from 304 to 300.
 *
 * The two icons now carry `hitSlop` to stay above the 44pt floor, the same
 * trade the kind badge and the note dot already make: the rule is about what a
 * thumb can hit, not what is painted, and the 56pt line height gives all four
 * the other axis outright. Every column keeps at least 2pt of margin over its
 * widest legal value at 1.2×, so none of them is one re-measurement away from
 * being the bug this was.
 *
 * The widths are fixed rather than flexed so that fifteen lines form actual
 * columns: a weight that shifts left because the reps beside it went from 5 to
 * 12 is the same jitter tabular numerals exist to prevent, one level up.
 */
// The one source of truth, in a module the node test config can import.
// `row-widths.test.ts` guards the RPE cell against the regression that
// shipped; keeping the numbers here as well would let the two drift.
const W = ROW_WIDTHS;

/**
 * How far the system text slider may scale the figures and badges on this row.
 *
 * Capping font scaling is a real cost and it is taken deliberately, in exactly
 * one place: seven cells of fixed point width sitting in a row that is 300pt
 * wide on a 316pt frame cannot absorb the 3.1× the accessibility slider goes
 * to, and the failure mode is not "small text", it is the row folding over
 * itself and burying the delete button — which is what the owner photographed.
 * 1.2× is the largest multiplier every column above still fits at.
 *
 * Nothing else in the sheet is capped. The exercise names, the `heard:`
 * evidence, the cue, the blocked reasons, the source quote and every button
 * label scale without limit, and the figures stay legible because 18pt
 * semibold at 1.2× is 21.6pt. A user who needs more than that needs the figure
 * read out, and every cell on this row carries an `accessibilityLabel` that
 * does exactly that.
 */
const COMPACT_SCALE_CAP = 1.2;

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
  /**
   * `flexShrink: 1` is the structural backstop under `W`'s arithmetic.
   *
   * Every other child of the line is fixed-width and React Native does not
   * shrink those by default, so if the budget were ever wrong — a narrower
   * frame, a column widened without re-checking the sum — the controls would
   * walk off the right edge silently. The figures are the one pair that can
   * give width back without losing an affordance (they have
   * `adjustsFontSizeToFit`, so they get smaller rather than clipping), so they
   * are the ones allowed to. At 360pt and above this never engages.
   */
  figure: { height: LINE_HEIGHT, justifyContent: "center", flexShrink: 1 },
  figureInner: { flexDirection: "row", alignItems: "baseline", gap: 3 },
  figurePressed: { opacity: 0.55 },
  value: { ...tnum, color: color.ink, fontSize: 18, fontWeight: "600" },
  valueBad: { color: color.bad },
  unit: { ...microLabel, marginBottom: 0, color: color.muted },

  // `minWidth` so the figures and the controls never actually touch: the
  // figures shrink into it rather than it closing to zero. See `styles.figure`.
  spacer: { flex: 1, minWidth: space.sm },

  /**
   * 30pt wide and 56pt tall, with horizontal `hitSlop` taking the effective
   * target past the 44pt floor. A 44pt-wide badge here would cost 14pt the RPE
   * and weight columns need more, and the rule is about what the thumb can hit,
   * not what is painted.
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
            {/*
              `adjustsFontSizeToFit` is not here for any legal weight — the
              column is sized for all of those at `COMPACT_SCALE_CAP`. It is
              for the implausible one: the pad will accept `99999`, and such a
              row already blocks the confirm button and draws its figure in
              `color.bad`, so the honest rendering is a number that got smaller
              rather than a row that wrapped into two lines. `numberOfLines`
              is what makes that possible and is the hard floor under it.
            */}
            <Text
              style={[styles.value, offending === "weight" && styles.valueBad]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              maxFontSizeMultiplier={COMPACT_SCALE_CAP}
            >
              {fmtWeight(row.weightLb)}
            </Text>
            <Text style={styles.unit} numberOfLines={1} maxFontSizeMultiplier={COMPACT_SCALE_CAP}>
              lb
            </Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => onOpenPad(row.key, "reps")}
          accessibilityRole="button"
          accessibilityLabel={`${row.reps} reps, ${where}. Tap to change.`}
          style={({ pressed }) => [styles.figure, { width: W.reps }, pressed && styles.figurePressed]}
        >
          <View style={styles.figureInner}>
            <Text
              style={[styles.value, offending === "reps" && styles.valueBad]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              maxFontSizeMultiplier={COMPACT_SCALE_CAP}
            >
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
                <Text
                  style={[styles.badgeText, kind === "failure" && styles.badgeTextFailure]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={COMPACT_SCALE_CAP}
                >
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
                <Text
                  style={styles.rpeEmpty}
                  numberOfLines={1}
                  maxFontSizeMultiplier={COMPACT_SCALE_CAP}
                >
                  RPE
                </Text>
              ) : (
                /*
                  The cell the owner's screenshot broke. `numberOfLines={1}` is
                  the invariant — this control has six legal answers and `@10`
                  is one of them, so it must never become two lines whatever
                  the text size is — and `W.rpe` is wide enough that it never
                  has to clip to honour that. `adjustsFontSizeToFit` is
                  deliberately absent: a `7.5` the parser produced is a legal
                  value and must render at full size, and the alternative to
                  shrinking the RPE was shrinking the icons beside it, which is
                  what happened.
                */
                <Text
                  style={[styles.rpeText, offending === "rpe" && styles.rpeTextBad]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={COMPACT_SCALE_CAP}
                >
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
              <Text
                style={row.note === "" ? styles.noteOff : styles.noteOn}
                numberOfLines={1}
                maxFontSizeMultiplier={COMPACT_SCALE_CAP}
              >
                ●
              </Text>
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
          // 38pt painted, 46pt reachable. See `W`.
          hitSlop={{ left: 4, right: 4 }}
          style={({ pressed }) => [styles.icon, pressed && styles.iconPressed]}
        >
          <Text style={styles.iconText} numberOfLines={1} maxFontSizeMultiplier={COMPACT_SCALE_CAP}>
            ⊕
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            tapSelect();
            onDelete(row.key);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${where}`}
          hitSlop={{ left: 4, right: 4 }}
          style={({ pressed }) => [styles.icon, pressed && styles.iconPressed]}
        >
          <Text
            style={[styles.iconText, styles.iconDanger]}
            numberOfLines={1}
            maxFontSizeMultiplier={COMPACT_SCALE_CAP}
          >
            ×
          </Text>
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

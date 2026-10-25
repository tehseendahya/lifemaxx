import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import { Button, Label, Sheet, color, space } from "@/components/ui";
import { microLabel } from "@/components/ui/Label";
import { tapSelect } from "@/lib/haptics";
import { SetRow } from "./SetRow";
import {
  blockedReason,
  canConfirm,
  confirmLabel,
  type LogRow,
  type PadField,
  type RowPatch,
} from "./model";

/**
 * Tall enough for four rows, short enough that the session stays visible
 * behind it. Beyond that the list scrolls rather than the sheet growing to
 * cover the screen — the point of a sheet here is that the set you just did is
 * still on screen while you check what is about to be written.
 */
const LIST_MAX_HEIGHT = 420;

const styles = StyleSheet.create({
  source: { paddingVertical: space.sm },
  sourcePressed: { opacity: 0.6 },
  sourceText: { color: color.muted, fontSize: 13, lineHeight: 19 },
  sourceHint: { ...microLabel, marginBottom: 0, marginTop: space.xs },

  list: { marginTop: space.md },

  blocked: { color: color.bad, fontSize: 13, lineHeight: 19, marginTop: space.sm },
  error: { color: color.bad, fontSize: 13, lineHeight: 19, marginBottom: space.sm },

  empty: { color: color.ink, fontSize: 15, lineHeight: 21, marginTop: space.md },
  emptyNote: { color: color.muted, fontSize: 13, lineHeight: 19, marginTop: space.sm },

  confirm: { marginTop: space.md },
  secondary: { marginTop: space.sm },
});

/**
 * Nothing is written before this.
 *
 * The parse is a proposal. It arrives here as one row per set, every number
 * tappable, every exercise re-fileable, and the confirm button disabled until
 * every row has a real exercise id. A set filed against the wrong exercise is
 * the only failure in this flow that is invisible afterwards — it looks like a
 * successful log and quietly splits the trend chart in two — so the one thing
 * this sheet will not do is guess on the user's behalf.
 *
 * The source text sits at the top, verbatim, and is tappable to re-parse. That
 * is the escape hatch for a sentence the model read wrong, and it is why the
 * text is never discarded: the user can always get back to what they actually
 * wrote.
 */
export function ConfirmSheet({
  visible,
  rows,
  sourceText,
  sourceLabel,
  usedModel,
  queueing,
  error,
  onEditSource,
  onOpenPad,
  onPatch,
  onDuplicate,
  onDelete,
  onPickExercise,
  onConfirm,
  onLogByHand,
  onClose,
}: {
  visible: boolean;
  rows: LogRow[];
  /** What the user typed or what came back from transcription. Shown verbatim. */
  sourceText: string;
  /** `TYPED` or `HEARD` — which door this came in through. */
  sourceLabel: string;
  usedModel: boolean;
  /** True while the rows are being written to the outbox. */
  queueing: boolean;
  error: string | null;
  onEditSource: () => void;
  onOpenPad: (key: string, field: PadField) => void;
  onPatch: (key: string, patch: RowPatch) => void;
  onDuplicate: (key: string) => void;
  onDelete: (key: string) => void;
  onPickExercise: (entryKey: string, query: string) => void;
  onConfirm: () => void;
  /** Adds one empty row so the set can be logged without the parser. */
  onLogByHand: () => void;
  onClose: () => void;
}) {
  const blocked = blockedReason(rows);
  const ready = canConfirm(rows) && !queueing;

  return (
    <Sheet visible={visible} onClose={onClose} title="Before this is logged">
      <Label>{sourceLabel}</Label>
      <Pressable
        onPress={() => {
          tapSelect();
          onEditSource();
        }}
        accessibilityRole="button"
        accessibilityLabel="Edit what was read and parse it again"
        style={({ pressed }) => [styles.source, pressed && styles.sourcePressed]}
      >
        <Text style={styles.sourceText}>{sourceText}</Text>
        <Text style={styles.sourceHint}>
          {usedModel ? "READ BY THE MODEL · TAP TO FIX" : "READ WITHOUT THE NETWORK · TAP TO FIX"}
        </Text>
      </Pressable>

      {error !== null && <Text style={styles.error}>{error}</Text>}

      {rows.length === 0 ? (
        <>
          <Text style={styles.empty}>Couldn’t parse that.</Text>
          <Text style={styles.emptyNote}>
            Tap the line above to edit it and try again — it hasn’t been lost. Or log the set by
            hand: you get one row, and tapping a figure opens the pad.
          </Text>
        </>
      ) : (
        <ScrollView
          style={[styles.list, { maxHeight: LIST_MAX_HEIGHT }]}
          // The rows are the point; the sheet must not steal a drag that was
          // aimed at scrolling them.
          keyboardShouldPersistTaps="handled"
        >
          {rows.map((row, i) => (
            <SetRow
              key={row.key}
              row={row}
              index={i + 1}
              onOpenPad={onOpenPad}
              onPatch={onPatch}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
              onPickExercise={onPickExercise}
            />
          ))}
        </ScrollView>
      )}

      {blocked !== null && <Text style={styles.blocked}>{blocked}</Text>}

      {/*
        Two different buttons, not one with a conditional label. With nothing
        parsed the primary action is "give me a row to fill in", which is always
        available; with rows on screen it is "write these", which is gated on
        every one of them having a real exercise.
      */}
      {rows.length === 0 ? (
        <Button size="lg" style={styles.confirm} onPress={onLogByHand}>
          LOG BY HAND
        </Button>
      ) : (
        <Button size="lg" style={styles.confirm} disabled={!ready} onPress={onConfirm}>
          {queueing ? "SAVING…" : confirmLabel(rows)}
        </Button>
      )}

      <Button variant="ghost" style={styles.secondary} onPress={onClose}>
        DISCARD
      </Button>
    </Sheet>
  );
}

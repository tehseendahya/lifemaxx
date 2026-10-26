import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button, Sheet, color, space } from "@/components/ui";
import { microLabel } from "@/components/ui/Label";
import { tapSelect } from "@/lib/haptics";
import { GROUP_BORDER, GroupHeader } from "./GroupHeader";
import { SetLine } from "./SetLine";
import type { LineControl } from "./SetLine";
import {
  blockedReason,
  canConfirm,
  confirmLabel,
  cueFor,
  groupRows,
  parseHint,
  sourceDoorLabel,
  type LogRow,
  type PadField,
  type RowPatch,
  type SourceKind,
} from "./model";

const styles = StyleSheet.create({
  source: { paddingBottom: space.sm },
  sourcePressed: { opacity: 0.6 },
  sourceLabel: { ...microLabel, marginBottom: space.xs },
  sourceText: { color: color.muted, fontSize: 13, lineHeight: 19 },
  sourceHint: { ...microLabel, marginBottom: 0, marginTop: space.xs },

  /**
   * NOT `flex: 1`, and that is the whole trick of this layout.
   *
   * `flex: 1` sets `flexBasis: 0`, so inside a panel whose height is `auto`
   * this list would contribute nothing to the panel's natural height and
   * collapse to zero — the sheet would render with a header, a footer and no
   * sets. `flexShrink: 1` gives it its content height when there is room and
   * lets it give height back when `Sheet`'s `maxHeight` clamps the panel, which
   * is exactly "as tall as it can be and no taller".
   *
   * Views in React Native do not shrink by default (`flexShrink: 0`), so the
   * header and footer around it keep their size and stay pinned.
   */
  list: { flexShrink: 1, borderTopWidth: 1, borderTopColor: color.line },

  group: { paddingBottom: space.lg },

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
 * The parse is a proposal. It arrives as one row per set and is drawn as one
 * GROUP per exercise, every number tappable, every exercise re-fileable, and
 * the confirm button disabled until every row has a real exercise id and
 * believable figures. A set filed against the wrong exercise is the only
 * failure in this flow that is invisible afterwards — it looks like a
 * successful log and quietly splits the trend chart in two — so the one thing
 * this sheet will not do is guess on the user's behalf.
 *
 * ── WHAT CHANGED, AND WHY THE STRUCTURE WAS THE BUG ────────────────────────
 *
 * The owner's five-line paste produced FIFTEEN bordered cards, most of them
 * identical, under a title hidden behind the status bar clock. The styling was
 * not the problem: the unit of the sheet was a set and the unit of their
 * thinking is an exercise. So the exercise is now a header with its match state
 * on it, the sets under it are 56pt lines, and the header and footer are pinned
 * OUTSIDE the scroll view — with fifteen cards the old panel grew past the
 * screen, and since `Sheet`'s root is `justifyContent: "flex-end"` the overflow
 * went off the TOP, which is why the title ended up under the clock. `Sheet`
 * now caps the panel; pinning the ends here is what makes the confirm button
 * reachable without scrolling fifteen sets first.
 *
 * The source text sits at the top, verbatim, and is tappable to re-parse. That
 * is the escape hatch for a sentence read wrong, and it is why the text is
 * never discarded: the user can always get back to what they actually wrote.
 *
 * ── THE CUE RIDES ALONG, AND IS NOT PART OF THE CONFIRMATION ───────────────
 *
 * Each group header shows the carry-forward cue pinned to that lift and can
 * edit it. That write goes straight to `POST /api/mobile/exercise/cue` the
 * moment it is saved — it is NOT gated on the confirm button and is NOT undone
 * by DISCARD. A cue is a fact about the exercise, not about these sets: an
 * owner who opens this sheet, writes "elbows tucked", then decides the parse
 * was wrong and discards it has still written that cue on purpose, and taking
 * it back because of an unrelated decision would be the app overruling them.
 * The only thing this sheet gates is sets.
 *
 * There is one case where a cue does go away and it is correct that it does:
 * a cue pinned to an exercise this parse CREATED. DISCARD hands that exercise
 * back (`dropCreated`), and `exercise_cues` cascades on the exercise, so the
 * cue leaves with the lift it described. A cue pinned to a lift that no longer
 * exists would have nowhere to appear.
 */
export function ConfirmSheet({
  visible,
  rows,
  sourceText,
  sourceKind,
  usedModel,
  cues,
  queueing,
  error,
  onEditSource,
  onOpenPad,
  onPatch,
  onOpenNote,
  onEditCue,
  onDuplicate,
  onDelete,
  onPickExercise,
  onUseNearMiss,
  onBulk,
  onConfirm,
  onLogByHand,
  onClose,
}: {
  visible: boolean;
  rows: LogRow[];
  /** What the user typed or what came back from transcription. Shown verbatim. */
  sourceText: string;
  /** Which door this came in through. Drives the label and the provenance hint. */
  sourceKind: SourceKind;
  usedModel: boolean;
  /**
   * Every carry-forward cue this user has, keyed by exercise id, straight off
   * `bootstrap.cues`. Optional, because a server that predates the field sends
   * nothing and that has to draw as no cues rather than as a crash.
   */
  cues: Record<string, string> | undefined;
  /** True while the rows are being written to the outbox. */
  queueing: boolean;
  error: string | null;
  onEditSource: () => void;
  onOpenPad: (key: string, field: PadField) => void;
  onPatch: (key: string, patch: RowPatch) => void;
  onOpenNote: (key: string) => void;
  /** Open the cue editor for one lift. Pinned to the exercise, not to a set. */
  onEditCue: (exerciseId: string, exerciseName: string) => void;
  onDuplicate: (key: string) => void;
  onDelete: (key: string) => void;
  onPickExercise: (entryKey: string, query: string) => void;
  onUseNearMiss: (entryKey: string, nearMiss: { id: string; name: string }) => void;
  onBulk: (entryKey: string) => void;
  onConfirm: () => void;
  /** Adds one empty row so the set can be logged without the parser. */
  onLogByHand: () => void;
  onClose: () => void;
}) {
  /**
   * Which line has an inline control expanded — at most one in the whole sheet.
   *
   * Local because it is pure view state: it changes nothing that gets written,
   * nothing else needs to read it, and plumbing it through the parent would
   * make a tap on a segment a round trip through `QuickLog`. One at a time
   * across all lines, not one per line, so the list's height stays predictable
   * while scrolling fifteen rows.
   */
  const [open, setOpen] = useState<{ key: string; control: LineControl } | null>(null);

  const groups = groupRows(rows);
  const blocked = blockedReason(rows);
  const ready = canConfirm(rows) && !queueing;

  return (
    <Sheet visible={visible} onClose={onClose} title="Before this is logged">
      <Pressable
        onPress={() => {
          tapSelect();
          onEditSource();
        }}
        accessibilityRole="button"
        accessibilityLabel="Edit what was read and parse it again"
        style={({ pressed }) => [styles.source, pressed && styles.sourcePressed]}
      >
        <Text style={styles.sourceLabel}>{sourceDoorLabel(sourceKind)}</Text>
        {/*
          Two lines, not all five. The paste is evidence, not the content of the
          sheet — the groups below are what the user is checking, and a
          five-line quotation at the top pushes the first exercise off screen.
        */}
        <Text style={styles.sourceText} numberOfLines={2}>
          {sourceText}
        </Text>
        {/*
          What read this, at the granularity the server actually reports it.
          The two strings this replaces both over-claimed — see `parseHint` in
          `model.ts`, which holds the measurement and the reasoning.
        */}
        <Text style={styles.sourceHint}>{parseHint(sourceKind, usedModel)}</Text>
      </Pressable>

      {error !== null && <Text style={styles.error}>{error}</Text>}

      {groups.length === 0 ? (
        <>
          <Text style={styles.empty}>Couldn’t parse that.</Text>
          <Text style={styles.emptyNote}>
            Tap the line above to edit it and try again — it hasn’t been lost. Or log the set by
            hand: you get one row, and tapping a figure opens the pad.
          </Text>
        </>
      ) : (
        <ScrollView
          style={styles.list}
          // The rows are the point; the sheet must not steal a drag that was
          // aimed at scrolling them.
          keyboardShouldPersistTaps="handled"
        >
          {groups.map((group) => (
            <View key={group.entryKey} style={[styles.group, GROUP_BORDER[group.match]]}>
              <GroupHeader
                group={group}
                cue={cueFor(group.exerciseId, cues)}
                onEditCue={onEditCue}
                onPickExercise={onPickExercise}
                onUseNearMiss={onUseNearMiss}
                onBulk={onBulk}
              />
              {group.rows.map((row, i) => (
                <SetLine
                  key={row.key}
                  row={row}
                  index={i + 1}
                  exerciseName={group.exerciseName ?? group.query}
                  open={open !== null && open.key === row.key ? open.control : null}
                  onOpen={(control) => setOpen(control === null ? null : { key: row.key, control })}
                  onOpenPad={onOpenPad}
                  onPatch={onPatch}
                  onOpenNote={onOpenNote}
                  onDuplicate={onDuplicate}
                  onDelete={onDelete}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}

      {blocked !== null && <Text style={styles.blocked}>{blocked}</Text>}

      {/*
        Two different buttons, not one with a conditional label. With nothing
        parsed the primary action is "give me a row to fill in", which is always
        available; with rows on screen it is "write these", which is gated on
        every one of them having a real exercise and figures a set can have.
      */}
      {groups.length === 0 ? (
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

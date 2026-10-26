import { useState } from "react";
import { Image, StyleSheet, Text, TextInput, View } from "react-native";

import {
  Button, Card, Label, Toggle,
  color, radius, space, tnum,
} from "@/components/ui";
import { tapSelect } from "@/lib/haptics";

import { REESTIMATE_WARNING, type ComposePhoto } from "./compose";
import { MealEditor, useItemPad } from "./MealEditor";
import {
  MEAL_SLOTS, SLOT_LABELS,
  draftTotals, formatMacroLine,
  type DraftItem, type MealSlot,
} from "./model";

/**
 * The editable review card — the part of this feature that makes the numbers
 * trustworthy.
 *
 * Analysis never saves directly, and that is a deliberate extra step in a flow
 * whose whole target is eight seconds. Photo macro estimation is roughly ±20%
 * on a single meal and systematically under-counts cooking oil, so a card that
 * wrote straight to the database would be a calorie tracker that quietly
 * invents a 300kcal deficit. One screen the user can correct is what turns an
 * estimate into a number the TDEE calculation can be built on.
 *
 * The card is fully controlled: `MealCapture` owns the items, the caption, the
 * slot and the photo, because RE-ESTIMATE needs all of them at once and has to
 * replace the items without throwing away the slot or the caption the user
 * just fixed. Every figure is typed on `NumberPad` (via `MealEditor`); the
 * caption and item names are prose and use the keyboard.
 */

/** Below this the model is telling us it guessed, and the user should be told. */
const LOW_CONFIDENCE = 0.6;

const styles = StyleSheet.create({
  head: { flexDirection: "row", gap: space.md, marginBottom: space.md },
  /**
   * The photo the estimate was made from, at 64pt — enough to recognise the
   * plate, small enough to leave the caption beside it room to be edited.
   */
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: color.surface2 },
  caption: {
    flex: 1,
    minHeight: 64,
    maxHeight: 114,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface2,
    color: color.ink,
    fontSize: 14,
    lineHeight: 19,
    textAlignVertical: "top",
  },

  totalRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.md,
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  totalLabel: { color: color.muted, fontSize: 13 },
  totalFigure: { ...tnum, color: color.ink, fontSize: 15, fontWeight: "500" },

  hint: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: space.sm },
  warn: { color: color.warn, fontSize: 12, lineHeight: 17, marginTop: space.sm },
  bad: { color: color.bad, fontSize: 12, lineHeight: 17, marginTop: space.sm },

  slots: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.lg },
  actions: { gap: space.sm },
  confirm: { flexDirection: "row", gap: space.sm },
  confirmButton: { flex: 1 },
});

export function ReviewCard({
  photo,
  caption,
  onCaptionChange,
  items,
  onItemsChange,
  edited,
  confidence,
  slot,
  onSlotChange,
  saving,
  reestimating,
  error,
  onSave,
  onReestimate,
  onCancel,
}: {
  /** In memory only. Shown so the user can see what was estimated. */
  photo: ComposePhoto | null;
  caption: string;
  onCaptionChange: (caption: string) => void;
  items: DraftItem[];
  onItemsChange: (items: DraftItem[]) => void;
  /** True once the items differ from what the analysis returned. */
  edited: boolean;
  confidence: number | null;
  slot: MealSlot;
  onSlotChange: (slot: MealSlot) => void;
  saving: boolean;
  reestimating: boolean;
  error: string | null;
  onSave: () => void;
  onReestimate: () => void;
  onCancel: () => void;
}) {
  const pad = useItemPad(items, onItemsChange);
  /** Re-estimating over hand edits asks first, inline. */
  const [confirming, setConfirming] = useState(false);

  const busy = saving || reestimating;
  const lowConfidence = confidence !== null && confidence < LOW_CONFIDENCE;
  // Re-estimate needs something to estimate from, same as LOG MEAL did.
  const canReestimate = photo !== null || caption.trim() !== "";

  function reestimate() {
    tapSelect();
    if (edited && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onReestimate();
  }

  return (
    <>
      <Card>
        <Label style={{ marginBottom: space.sm }}>Check the numbers</Label>

        <View style={styles.head}>
          {photo !== null ? (
            /*
             * React Native's own `Image`, from the in-memory data URL, and not
             * `expo-image`: expo-image keeps a disk cache, and a meal photo must
             * never be written anywhere.
             */
            <Image
              source={{ uri: photo.dataUrl }}
              style={styles.thumb}
              accessibilityLabel="The meal photo"
            />
          ) : null}
          <TextInput
            value={caption}
            onChangeText={onCaptionChange}
            placeholder="Add a note, then re-estimate"
            placeholderTextColor={color.muted}
            style={styles.caption}
            multiline
            editable={!busy}
            accessibilityLabel="Caption for this meal"
          />
        </View>

        <MealEditor items={items} onChange={onItemsChange} onOpenPad={pad.open} disabled={busy} />

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalFigure}>{formatMacroLine(draftTotals(items))}</Text>
        </View>

        {/* Reachable by removing every row. SAVE MEAL is disabled here —
            `POST /api/meals` rejects an empty item list — so the card says
            what to do rather than just refusing to work. */}
        {items.length === 0 ? (
          <Text style={styles.hint}>Nothing left to save. Add an item, or cancel.</Text>
        ) : null}

        {lowConfidence ? (
          <Text style={styles.warn}>
            Low confidence on this one. A note about portion size fixes it faster than anything else.
          </Text>
        ) : null}

        <Label style={{ marginTop: space.lg, marginBottom: space.sm }}>Slot</Label>
        <View style={styles.slots}>
          {MEAL_SLOTS.map((s) => (
            <Toggle key={s} on={slot === s} onPress={() => { tapSelect(); onSlotChange(s); }}>
              {SLOT_LABELS[s]}
            </Toggle>
          ))}
        </View>

        {error !== null ? <Text style={styles.bad}>{error}</Text> : null}

        <View style={styles.actions}>
          <Button size="lg" onPress={onSave} disabled={busy || items.length === 0}>
            {saving ? "Saving…" : "Save meal"}
          </Button>

          {confirming ? (
            <>
              <Text style={styles.warn}>{REESTIMATE_WARNING}</Text>
              <View style={styles.confirm}>
                <Button variant="secondary" style={styles.confirmButton} onPress={reestimate} disabled={busy}>
                  Re-estimate
                </Button>
                <Button
                  variant="ghost"
                  style={styles.confirmButton}
                  onPress={() => { tapSelect(); setConfirming(false); }}
                >
                  Keep edits
                </Button>
              </View>
            </>
          ) : (
            <Button variant="ghost" onPress={reestimate} disabled={busy || !canReestimate}>
              {reestimating ? "Reading…" : "Re-estimate"}
            </Button>
          )}

          {/* Discards the items and drops the in-memory photo. */}
          <Button variant="ghost" onPress={onCancel} disabled={busy}>Cancel</Button>
        </View>
      </Card>

      {pad.element}
    </>
  );
}

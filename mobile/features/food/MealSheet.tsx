import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { Button, Label, Sheet, Toggle, color, radius, space } from "@/components/ui";
import { tapSelect } from "@/lib/haptics";
import type { MealDto } from "@/lib/types";

import { MealEditor, useItemPad } from "./MealEditor";
import {
  MEAL_SLOTS, SLOT_LABELS,
  canSaveEdit, draftFromMeal, editorHeadline, isDirty, mealSourceLine, saveBlockedReason,
  type MealDraft,
} from "./model";

const styles = StyleSheet.create({
  source: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: -space.sm, marginBottom: space.md },

  /**
   * NOT `flex: 1`. `Sheet`'s panel is auto-height under a `maxHeight`, so a
   * `flex: 1` child sets `flexBasis: 0`, contributes nothing to the panel's
   * natural height and collapses to zero. `flexShrink: 1` gives it its content
   * height and lets it give height back when the cap bites. `ConfirmSheet`
   * documents the same trick at length. The keyboard wrapper needs the same.
   */
  shrink: { flexShrink: 1 },
  list: { flexShrink: 1 },

  slots: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.md },

  note: {
    minHeight: 44,
    maxHeight: 96,
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

  actions: { gap: space.sm, marginTop: space.md },
  row: { flexDirection: "row", gap: space.sm },
  half: { flex: 1 },
  hint: { color: color.muted, fontSize: 12, lineHeight: 17 },
  discard: { color: color.ink, fontSize: 14, lineHeight: 20 },
  bad: { color: color.bad, fontSize: 12, lineHeight: 17, marginTop: space.sm },
});

/**
 * A logged meal, opened straight into its item editor.
 *
 * The owner: "I like how i can see my meals of the day at the bottom, but
 * would be nice to be able to edit when click in too." So tapping a meal no
 * longer shows a read-only breakdown with delete-and-re-log as the only fix.
 * It shows the items as editable rows — quantity (which rescales the macros),
 * each macro, the name, delete, add — plus the slot and the note, and SAVE
 * CHANGES writes the whole edited meal through `POST /api/mobile/meal`.
 * Re-parsing is the secondary path: "+ Add item → Describe it" appends what a
 * sentence describes, without re-estimating what is already there.
 *
 * ── WHY A SHEET AND NOT AN EXPANDING ROW ───────────────────────────────────
 *
 * The meal row sits in a scrolling day list and the owner logs one-handed: an
 * expand-in-place would reflow every row below it, while this panel is anchored
 * in thumb reach, caps and scrolls itself, and leaves the list untouched.
 *
 * ── UNSAVED EDITS ──────────────────────────────────────────────────────────
 *
 * Tapping the backdrop with unsaved edits does not close the sheet; it asks
 * "Discard changes?" inline, with DISCARD and KEEP EDITING. No `Alert`.
 *
 * Every decision — the draft, dirtiness, what blocks a save, the live title —
 * is in `model.ts` and tested; this file only draws them.
 */
export function MealSheet({ meal, busy, saving, error, onSave, onRepeat, onRemove, onClose }: {
  /** Null closes the sheet. The panel stays mounted while it slides out. */
  meal: MealDto | null;
  busy: boolean;
  /** True while SAVE CHANGES is the action in flight, for its label. */
  saving: boolean;
  error: string | null;
  onSave: (meal: MealDto, draft: MealDraft) => void;
  onRepeat: (meal: MealDto) => void;
  onRemove: (meal: MealDto) => void;
  onClose: () => void;
}) {
  const [original, setOriginal] = useState<MealDraft | null>(null);
  const [draft, setDraft] = useState<MealDraft | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);

  /*
   * Seeded from the meal's ID, not the meal object: the day list refetches on
   * focus and after every write, handing a fresh object for the same meal, and
   * re-seeding on that would throw away what the user was typing. A different
   * meal (or a closed sheet) is what resets the draft.
   *
   * Reset during render rather than in an effect, so the sheet's first frame
   * already has its items: `Sheet` measures the panel to animate it in, and an
   * empty first frame would give it the wrong travel.
   */
  const id = meal?.id ?? null;
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (id !== seededFor) {
    const seeded = meal === null ? null : draftFromMeal(meal);
    setSeededFor(id);
    setOriginal(seeded);
    setDraft(seeded);
    setAskDiscard(false);
  }

  const items = draft?.items ?? [];
  const pad = useItemPad(items, (next) => setDraft((d) => (d === null ? d : { ...d, items: next })));

  const dirty = original !== null && draft !== null && isDirty(original, draft);

  function requestClose() {
    if (busy) return;
    if (dirty && !askDiscard) {
      tapSelect();
      setAskDiscard(true);
      return;
    }
    onClose();
  }

  const blocked = draft === null ? null : saveBlockedReason(draft);

  return (
    <>
      <Sheet
        visible={meal !== null}
        onClose={requestClose}
        title={draft !== null ? editorHeadline(draft.slot, draft.items) : undefined}
      >
        {meal !== null && draft !== null && original !== null ? (
          /*
           * The item names and the note use the keyboard, and this panel is
           * anchored to the bottom of the screen, so without this the keyboard
           * would cover the field being typed in. `padding` grows the panel
           * upward by the overlap; the list then shrinks under the height cap.
           */
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.shrink}
          >
            {mealSourceLine(meal) !== null ? <Text style={styles.source}>{mealSourceLine(meal)}</Text> : null}

            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              <View style={styles.slots}>
                {MEAL_SLOTS.map((s) => (
                  <Toggle
                    key={s}
                    on={draft.slot === s}
                    onPress={() => { tapSelect(); setDraft({ ...draft, slot: s }); setAskDiscard(false); }}
                  >
                    {SLOT_LABELS[s]}
                  </Toggle>
                ))}
              </View>

              <MealEditor
                items={draft.items}
                onChange={(next) => { setDraft({ ...draft, items: next }); setAskDiscard(false); }}
                onOpenPad={pad.open}
                disabled={busy}
              />

              {/* The sentence the meal was logged from. Provenance, and editable:
                  it is the only place a detail like "no oil" survives. */}
              <Label style={{ marginTop: space.lg, marginBottom: space.xs }}>Note</Label>
              <TextInput
                value={draft.note}
                onChangeText={(note) => setDraft({ ...draft, note })}
                placeholder="What this meal was"
                placeholderTextColor={color.muted}
                style={styles.note}
                multiline
                editable={!busy}
                accessibilityLabel="Meal note"
              />
            </ScrollView>

            <View style={styles.actions}>
              {askDiscard ? (
                <>
                  <Text style={styles.discard}>Discard changes?</Text>
                  <View style={styles.row}>
                    <Button variant="danger" style={styles.half} onPress={() => { tapSelect(); onClose(); }}>
                      Discard
                    </Button>
                    <Button variant="secondary" style={styles.half} onPress={() => { tapSelect(); setAskDiscard(false); }}>
                      Keep editing
                    </Button>
                  </View>
                </>
              ) : (
                <>
                  <Button
                    size="lg"
                    onPress={() => onSave(meal, draft)}
                    disabled={busy || !canSaveEdit(original, draft)}
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                  {blocked !== null ? <Text style={styles.hint}>{blocked}</Text> : null}
                  <View style={styles.row}>
                    <Button
                      variant="secondary"
                      style={styles.half}
                      onPress={() => onRepeat(meal)}
                      disabled={busy || meal.items.length === 0}
                    >
                      Repeat on today
                    </Button>
                    <Button variant="danger" style={styles.half} onPress={() => onRemove(meal)} disabled={busy}>
                      Delete
                    </Button>
                  </View>
                </>
              )}
            </View>

            {error !== null ? <Text style={styles.bad}>{error}</Text> : null}
          </KeyboardAvoidingView>
        ) : null}
      </Sheet>

      {/* A sibling of the sheet, never inside it — see `MealEditor`. */}
      {pad.element}
    </>
  );
}

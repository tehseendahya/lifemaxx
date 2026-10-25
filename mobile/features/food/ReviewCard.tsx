import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  Button, Card, Label, NumberPad, Toggle,
  color, hit, microLabel, radius, space, tnum,
} from "@/components/ui";
import { tapSave, tapSelect } from "@/lib/haptics";

import {
  MACRO_FIELDS, MEAL_SLOTS,
  defaultSlot, draftTotals, emptyDraftItem, formatMacroLine, patchItem, removeItem,
  type AnalyzedItem, type DraftItem, type MacroField, type MealSlot,
} from "./model";
import { toAnalyzed } from "./model";

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
 * Every figure here is typed on `NumberPad`, never on a `TextInput`. A numeric
 * keyboard inside a scrolling card is the worst case for the complaint that
 * started this project: it animates in, shoves the card up the screen, and
 * costs a focus round-trip before the first digit lands. The two `TextInput`s
 * that remain are for text — item names — which is a different thing.
 */

/** Below this the model is telling us it guessed, and the user should be told. */
const LOW_CONFIDENCE = 0.6;

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: hit.min,
  },
  itemBlock: {
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    paddingVertical: space.xs,
  },
  itemBlockLast: { borderBottomWidth: 0 },

  nameInput: {
    flex: 1,
    minWidth: 0,
    // Matched to the macro fields' 44pt so the row reads as one control strip
    // rather than as a short box beside two tall ones.
    height: hit.min,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    backgroundColor: color.surface2,
    color: color.ink,
    fontSize: 14,
  },

  field: {
    minHeight: hit.min,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    backgroundColor: color.surface2,
  },
  fieldPressed: { backgroundColor: color.line },
  fieldKcal: { minWidth: 64 },
  fieldMacro: { minWidth: 52 },
  fieldText: { ...tnum, color: color.ink, fontSize: 14 },
  fieldUnit: { color: color.muted, fontSize: 12 },

  remove: {
    width: 36,
    minHeight: hit.min,
    alignItems: "center",
    justifyContent: "center",
  },
  removeGlyph: { color: color.muted, fontSize: 20 },

  moreRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs },
  moreToggle: { minHeight: 32, justifyContent: "center", paddingRight: space.sm },
  moreLabel: { ...microLabel },
  /** Inside the `More` row, which is a flex row — hence the grow. */
  portion: { ...tnum, color: color.muted, fontSize: 12, flex: 1 },
  /**
   * The note echoed back under the totals. Deliberately NOT `styles.portion`:
   * that style carries `flex: 1`, and a flex child of a column container with
   * no height collapses to nothing — the line would silently disappear.
   */
  noteEcho: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: space.sm },

  addRow: {
    minHeight: hit.min,
    justifyContent: "center",
    marginTop: space.sm,
  },
  addLabel: { ...microLabel, color: color.accent },

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

  warn: { color: color.warn, fontSize: 12, lineHeight: 17, marginTop: space.sm },
  bad: { color: color.bad, fontSize: 12, lineHeight: 17, marginTop: space.sm },

  slots: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.lg },
  actions: { gap: space.sm },
});

interface PadTarget {
  itemKey: string;
  field: MacroField;
  value: string;
}

export function ReviewCard({
  initialItems,
  confidence,
  note,
  saving,
  error,
  onSave,
  onCancel,
}: {
  /** Taken as the initial state; remount with a new `key` to replace it. */
  initialItems: DraftItem[];
  confidence: number | null;
  /** Shown back to the user so they can see what the analysis was told. */
  note: string;
  saving: boolean;
  error: string | null;
  onSave: (items: AnalyzedItem[], slot: MealSlot) => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState<DraftItem[]>(initialItems);
  const [slot, setSlot] = useState<MealSlot>(() => defaultSlot());
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  /*
   * The pad's target and its visibility are separate pieces of state on
   * purpose. `NumberPad` stays mounted while it slides out, and clearing the
   * target on dismissal would empty the readout mid-animation — the panel would
   * visibly blank out as it left. So the target survives the close and is
   * replaced on the next open.
   */
  const [pad, setPad] = useState<PadTarget | null>(null);
  const [padVisible, setPadVisible] = useState(false);

  const totals = draftTotals(items);

  function openPad(item: DraftItem, field: MacroField) {
    tapSelect();
    // The current figure is seeded as a string, so a correction starts from
    // what is there rather than from an empty field — most edits are "215 is
    // nearer 260", not "replace this with a number I have in mind".
    setPad({ itemKey: item.key, field, value: String(Math.round(item[field])) });
    setPadVisible(true);
  }

  function commitPad() {
    if (pad) {
      tapSave();
      // An empty readout means the user deleted every digit. That is zero, not
      // "leave it alone" — this field always has a value, unlike a weight that
      // can fall back to a suggestion.
      setItems((current) => patchItem(current, pad.itemKey, { [pad.field]: Number(pad.value || "0") }));
    }
    setPadVisible(false);
  }

  function addItem() {
    tapSelect();
    setItems((current) => [...current, emptyDraftItem()]);
  }

  function drop(key: string) {
    tapSelect();
    setItems((current) => removeItem(current, key));
    setExpanded((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  const lowConfidence = confidence !== null && confidence < LOW_CONFIDENCE;

  return (
    <>
      <Card>
        <Label>Check the numbers</Label>

        {items.map((item, i) => {
          const open = expanded[item.key] === true;
          return (
            <View key={item.key} style={[styles.itemBlock, i === items.length - 1 && styles.itemBlockLast]}>
              <View style={styles.row}>
                <TextInput
                  value={item.name}
                  onChangeText={(name) => setItems((current) => patchItem(current, item.key, { name }))}
                  placeholder="Item"
                  placeholderTextColor={color.muted}
                  style={styles.nameInput}
                  // A name is one line. Multiline here would let a paste grow
                  // the row and push the macros off the edge.
                  multiline={false}
                  returnKeyType="done"
                  accessibilityLabel="Item name"
                />
                <MacroField item={item} field="kcal" wide onPress={() => openPad(item, "kcal")} />
                <MacroField item={item} field="proteinG" onPress={() => openPad(item, "proteinG")} />
                <Pressable
                  onPress={() => drop(item.key)}
                  style={styles.remove}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.name || "item"}`}
                >
                  <Text style={styles.removeGlyph}>×</Text>
                </Pressable>
              </View>

              <View style={styles.moreRow}>
                <Pressable
                  onPress={() => {
                    tapSelect();
                    setExpanded((current) => ({ ...current, [item.key]: !open }));
                  }}
                  style={styles.moreToggle}
                  accessibilityRole="button"
                  accessibilityLabel={open ? "Hide carbs and fat" : "Edit carbs and fat"}
                >
                  <Text style={styles.moreLabel}>{open ? "Less ▴" : "More ▾"}</Text>
                </Pressable>

                {open ? (
                  <>
                    {/* Read-only: the portion the model estimated, which is
                        context for the macros rather than something to edit. */}
                    <Text style={styles.portion} numberOfLines={1}>
                      {item.qty !== null ? `${item.qty}${item.unit ? ` ${item.unit}` : ""}` : ""}
                    </Text>
                    <MacroField item={item} field="carbsG" onPress={() => openPad(item, "carbsG")} />
                    <MacroField item={item} field="fatG" onPress={() => openPad(item, "fatG")} />
                  </>
                ) : null}
              </View>
            </View>
          );
        })}

        {/* Reachable by removing every row. SAVE MEAL is disabled here —
            `POST /api/meals` rejects an empty item list — so the card has to
            say what to do rather than just refusing to work. */}
        {items.length === 0 ? (
          <Text style={styles.noteEcho}>Nothing left to save. Add an item, or cancel.</Text>
        ) : null}

        <Pressable
          onPress={addItem}
          style={styles.addRow}
          accessibilityRole="button"
          accessibilityLabel="Add an item"
        >
          <Text style={styles.addLabel}>+ Add item</Text>
        </Pressable>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalFigure}>{formatMacroLine(totals)}</Text>
        </View>

        {lowConfidence ? (
          <Text style={styles.warn}>
            Low confidence on this one. A note about portion size fixes it faster than anything else.
          </Text>
        ) : null}

        {note.trim() !== "" ? (
          <Text style={styles.noteEcho} numberOfLines={2}>{note.trim()}</Text>
        ) : null}

        <Label style={{ marginTop: space.lg }}>Slot</Label>
        <View style={styles.slots}>
          {MEAL_SLOTS.map((s) => (
            <Toggle
              key={s}
              on={slot === s}
              onPress={() => { tapSelect(); setSlot(s); }}
            >
              {SLOT_LABELS[s]}
            </Toggle>
          ))}
        </View>

        {error !== null ? <Text style={styles.bad}>{error}</Text> : null}

        <View style={styles.actions}>
          <Button
            size="lg"
            onPress={() => onSave(toAnalyzed(items), slot)}
            disabled={saving || items.length === 0}
          >
            {saving ? "Saving…" : "Save meal"}
          </Button>
          {/* Discards the items, the note and the in-memory image. */}
          <Button variant="ghost" onPress={onCancel} disabled={saving}>Cancel</Button>
        </View>
      </Card>

      <NumberPad
        visible={padVisible}
        value={pad?.value ?? ""}
        label={pad ? MACRO_FIELDS[pad.field].label : ""}
        unit={pad ? MACRO_FIELDS[pad.field].unit : undefined}
        // Integers only. Nobody corrects a meal to 42.5g of protein, and an
        // accidental decimal point in a gram figure is a number the user then
        // has to notice and undo.
        allowDecimal={false}
        onChange={(value) => {
          tapSelect();
          setPad((current) => (current ? { ...current, value } : current));
        }}
        onDone={commitPad}
        onCancel={() => setPadVisible(false)}
      />
    </>
  );
}

/**
 * One tappable figure. The unit rides along as a muted suffix so a column of
 * bare numbers does not need a header row to be readable.
 */
function MacroField({ item, field, wide, onPress }: {
  item: DraftItem;
  field: MacroField;
  wide?: boolean;
  onPress: () => void;
}) {
  const suffix = field === "kcal" ? "" : field === "proteinG" ? "p" : field === "carbsG" ? "c" : "f";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.field,
        wide ? styles.fieldKcal : styles.fieldMacro,
        pressed && styles.fieldPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${item.name || "Item"} ${MACRO_FIELDS[field].label}, ${Math.round(item[field])}`}
    >
      <Text style={styles.fieldText}>
        {Math.round(item[field])}
        {suffix === "" ? null : <Text style={styles.fieldUnit}>{suffix}</Text>}
      </Text>
    </Pressable>
  );
}

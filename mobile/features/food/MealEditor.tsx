import { useState, type ReactNode } from "react";
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import {
  Button, NumberPad,
  color, hit, microLabel, radius, space, tnum,
} from "@/components/ui";
import { tapError, tapSave, tapSelect } from "@/lib/haptics";

import {
  MACRO_FIELDS,
  appendItems, emptyDraftItem, formatQty, patchItem, removeItem, scaleItem,
  type DraftItem, type MacroField,
} from "./model";
import { OFFLINE_ANALYSIS, analyzeMeal, describeFailure } from "./requests";

/**
 * The item list of a meal, editable — shared by the review step after LOG MEAL
 * and by the sheet a logged meal opens into.
 *
 * Each item is two lines: its name and quantity, then its four macros. Every
 * figure is a tap target that opens `NumberPad` (never a numeric keyboard; see
 * the six rules). Changing the quantity rescales the macros through
 * `scaleItem`; changing a macro changes only that macro. The decisions are all
 * in `model.ts` and tested there — this file only draws them.
 *
 * ── THE PAD IS NOT RENDERED HERE ───────────────────────────────────────────
 *
 * `NumberPad` is a `Modal`, and so is the `Sheet` this list sits in when a
 * logged meal is being edited. This app opens the pad as a SIBLING of a sheet,
 * never inside it (`EditSetSheet` and `QuickLog` do the same), so the pad lives
 * in `useItemPad` and the caller places `pad.element` next to its sheet.
 */

const styles = StyleSheet.create({
  item: {
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    paddingVertical: space.xs,
  },
  itemLast: { borderBottomWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: hit.min },
  macros: { flexDirection: "row", alignItems: "center", gap: space.xs, marginTop: space.xs },

  nameInput: {
    flex: 1,
    minWidth: 0,
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
    alignItems: "center",
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    backgroundColor: color.surface2,
  },
  fieldMacro: { flex: 1, minWidth: 0 },
  /** "615 kcal" is twice as long as "69 P"; an equal share would clip it on an SE. */
  fieldKcal: { flex: 1.4 },
  fieldQty: { minWidth: 72, alignItems: "flex-end" },
  fieldPressed: { backgroundColor: color.line },
  fieldText: { ...tnum, color: color.ink, fontSize: 14 },
  fieldMuted: { ...tnum, color: color.muted, fontSize: 14 },
  fieldUnit: { color: color.muted, fontSize: 12 },

  remove: { width: hit.min, minHeight: hit.min, alignItems: "center", justifyContent: "center" },
  removeGlyph: { color: color.muted, fontSize: 20 },

  addRow: { minHeight: hit.min, justifyContent: "center", marginTop: space.sm },
  addLabel: { ...microLabel, color: color.accent },
  choices: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
  choice: { flex: 1 },

  describe: {
    minHeight: hit.min,
    marginTop: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface2,
    color: color.ink,
    fontSize: 14,
    lineHeight: 19,
  },
  describeActions: { flexDirection: "row", gap: space.sm, marginTop: space.sm },

  empty: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: space.sm },
  bad: { color: color.bad, fontSize: 12, lineHeight: 17, marginTop: space.sm },
});

/** What the pad is editing: one item's quantity, or one of its macros. */
type PadField = MacroField | "qty";

interface PadTarget {
  itemKey: string;
  field: PadField;
  value: string;
  /** Only a pressed key counts as an edit; see `commit`. */
  touched: boolean;
}

/**
 * The pad for an item list, as a hook so the caller can render it beside its
 * sheet rather than inside it.
 */
export function useItemPad(
  items: readonly DraftItem[],
  onChange: (items: DraftItem[]) => void,
): { open: (item: DraftItem, field: PadField) => void; element: ReactNode } {
  /*
   * Target and visibility are separate on purpose: `NumberPad` stays mounted
   * while it slides out, and clearing the target on dismissal would blank the
   * readout mid-animation.
   */
  const [pad, setPad] = useState<PadTarget | null>(null);
  const [visible, setVisible] = useState(false);

  function open(item: DraftItem, field: PadField) {
    tapSelect();
    // A name field may have the keyboard up; the pad replaces it, not joins it.
    Keyboard.dismiss();
    const value = field === "qty"
      ? item.qty === null ? "" : String(Math.round(item.qty * 100) / 100)
      : String(Math.round(item[field]));
    setPad({ itemKey: item.key, field, value, touched: false });
    setVisible(true);
  }

  function commit() {
    /*
     * An untouched pad commits nothing. The readout is seeded with a ROUNDED
     * figure, so writing it back on Done would turn 4.3 g into 4 g — and mark
     * a meal the user only looked at as edited.
     */
    if (pad !== null && pad.touched) {
      const item = items.find((i) => i.key === pad.itemKey);
      if (item) {
        tapSave();
        if (pad.field === "qty") {
          // An emptied quantity pad leaves the quantity alone rather than
          // clearing it: a cleared quantity is a lost basis for rescaling.
          if (pad.value !== "") {
            onChange(items.map((i) => (i.key === item.key ? scaleItem(i, Number(pad.value)) : i)));
          }
        } else {
          // An emptied macro is zero — the field always has a value.
          onChange(patchItem(items, item.key, { [pad.field]: Number(pad.value || "0") }));
        }
      }
    }
    setVisible(false);
  }

  const item = pad === null ? undefined : items.find((i) => i.key === pad.itemKey);
  const isQty = pad?.field === "qty";

  const element = (
    <NumberPad
      visible={visible}
      value={pad?.value ?? ""}
      label={pad === null ? "" : isQty ? "quantity" : MACRO_FIELDS[pad.field as MacroField].label}
      unit={pad === null ? undefined : isQty ? (item?.unit ?? undefined) : MACRO_FIELDS[pad.field as MacroField].unit}
      // A portion is "1.5 cup"; a macro is a whole number, as it always was.
      allowDecimal={isQty}
      onChange={(value) => {
        tapSelect();
        setPad((current) => (current ? { ...current, value, touched: true } : current));
      }}
      onDone={commit}
      onCancel={() => setVisible(false)}
    />
  );

  return { open, element };
}

export function MealEditor({ items, onChange, onOpenPad, disabled }: {
  items: DraftItem[];
  onChange: (items: DraftItem[]) => void;
  /** From `useItemPad`. */
  onOpenPad: (item: DraftItem, field: PadField) => void;
  disabled?: boolean;
}) {
  /** The "+ Add item" row's two choices, and the "Describe it" field. */
  const [adding, setAdding] = useState<"closed" | "choose" | "describe">("closed");
  const [describe, setDescribe] = useState("");
  const [describing, setDescribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function drop(key: string) {
    tapSelect();
    onChange(removeItem(items, key));
  }

  function typeItIn() {
    tapSelect();
    onChange([...items, emptyDraftItem()]);
    setAdding("closed");
  }

  /*
   * "Describe it": a text-only analysis whose items are APPENDED, never
   * substituted. This is how "a coke zero" gets added to a logged lunch
   * without re-estimating the lunch.
   */
  async function addDescribed() {
    const note = describe.trim();
    if (note === "") return;
    setDescribing(true);
    setError(null);
    try {
      const analysis = await analyzeMeal({ note });
      tapSave();
      onChange(appendItems(items, analysis.items));
      setDescribe("");
      setAdding("closed");
    } catch (err) {
      tapError();
      setError(describeFailure(err, OFFLINE_ANALYSIS));
    } finally {
      setDescribing(false);
    }
  }

  return (
    <View>
      {items.map((item, i) => (
        <View key={item.key} style={[styles.item, i === items.length - 1 && styles.itemLast]}>
          <View style={styles.row}>
            <TextInput
              value={item.name}
              onChangeText={(name) => onChange(patchItem(items, item.key, { name }))}
              placeholder="Item"
              placeholderTextColor={color.muted}
              style={styles.nameInput}
              // One line: a paste must not grow the row and push the figures off.
              multiline={false}
              returnKeyType="done"
              editable={!disabled}
              accessibilityLabel="Item name"
            />
            <Figure
              style={styles.fieldQty}
              onPress={() => onOpenPad(item, "qty")}
              disabled={disabled}
              label={`${item.name || "Item"} quantity, ${formatQty(item)}`}
            >
              <Text style={item.qty === null ? styles.fieldMuted : styles.fieldText}>{formatQty(item)}</Text>
            </Figure>
            <Pressable
              onPress={() => drop(item.key)}
              disabled={disabled}
              style={styles.remove}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.name || "item"}`}
            >
              <Text style={styles.removeGlyph}>×</Text>
            </Pressable>
          </View>

          <View style={styles.macros}>
            {(["kcal", "proteinG", "carbsG", "fatG"] as const).map((field) => (
              <Figure
                key={field}
                style={field === "kcal" ? [styles.fieldMacro, styles.fieldKcal] : styles.fieldMacro}
                onPress={() => onOpenPad(item, field)}
                disabled={disabled}
                label={`${item.name || "Item"} ${MACRO_FIELDS[field].label}, ${Math.round(item[field])}`}
              >
                <Text style={styles.fieldText} numberOfLines={1}>
                  {Math.round(item[field])}
                  <Text style={styles.fieldUnit}>{SUFFIX[field]}</Text>
                </Text>
              </Figure>
            ))}
          </View>
        </View>
      ))}

      {items.length === 0 ? <Text style={styles.empty}>No items. Add one below.</Text> : null}

      {adding === "closed" ? (
        <Pressable
          onPress={() => { tapSelect(); setAdding("choose"); }}
          disabled={disabled}
          style={styles.addRow}
          accessibilityRole="button"
          accessibilityLabel="Add an item"
        >
          <Text style={styles.addLabel}>+ Add item</Text>
        </Pressable>
      ) : adding === "choose" ? (
        /*
         * Inline rather than in a second sheet: when this list is itself in a
         * sheet, a sheet on a sheet is two stacked `Modal`s, which this app
         * never does. Two choices fit in a row.
         */
        <View style={styles.choices}>
          <Button variant="secondary" style={styles.choice} onPress={typeItIn} disabled={disabled}>
            Type it in
          </Button>
          <Button
            variant="secondary"
            style={styles.choice}
            onPress={() => { tapSelect(); setAdding("describe"); }}
            disabled={disabled}
          >
            Describe it
          </Button>
        </View>
      ) : (
        <>
          <TextInput
            value={describe}
            onChangeText={setDescribe}
            placeholder='"a coke zero", "tbsp of olive oil"'
            placeholderTextColor={color.muted}
            style={styles.describe}
            multiline
            autoFocus
            editable={!describing && !disabled}
            accessibilityLabel="Describe the item to add"
          />
          <View style={styles.describeActions}>
            <Button
              variant="secondary"
              style={styles.choice}
              onPress={() => { void addDescribed(); }}
              disabled={describing || disabled || describe.trim() === ""}
            >
              {describing ? "Reading…" : "Add"}
            </Button>
            <Button
              variant="ghost"
              style={styles.choice}
              onPress={() => { setAdding("closed"); setError(null); }}
              disabled={describing}
            >
              Never mind
            </Button>
          </View>
        </>
      )}

      {error !== null ? <Text style={styles.bad}>{error}</Text> : null}
    </View>
  );
}

const SUFFIX: Record<MacroField, string> = { kcal: " kcal", proteinG: " P", carbsG: " C", fatG: " F" };

/** One tappable figure, 44pt tall. */
function Figure({ style, onPress, disabled, label, children }: {
  style: StyleProp<ViewStyle>;
  onPress: () => void;
  disabled?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.field, style, pressed && styles.fieldPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the number pad"
    >
      {children}
    </Pressable>
  );
}

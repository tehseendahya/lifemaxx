import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Button, Label, Sheet, color, space, tnum } from "@/components/ui";
import type { MealDto } from "@/lib/types";

import { mealDetail, type MealItemRow } from "./model";

const styles = StyleSheet.create({
  /** The headline, pinned above the scroller. */
  total: { ...tnum, color: color.ink, fontSize: 15, fontWeight: "500" },
  source: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: space.xs },

  /**
   * NOT `flex: 1`. `Sheet`'s panel is auto-height under a `maxHeight`, so a
   * `flex: 1` child sets `flexBasis: 0`, contributes nothing to the panel's
   * natural height and collapses to zero — the sheet would open with a total,
   * two buttons and no items, which is the bug this whole screen exists to fix.
   * `flexShrink: 1` gives it its content height and lets it give height back
   * when the cap bites. `ConfirmSheet` documents the same trick at length.
   */
  list: {
    flexShrink: 1,
    marginTop: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },

  item: {
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  itemHead: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  itemName: { color: color.ink, fontSize: 15, lineHeight: 20, flexShrink: 1 },
  /**
   * The portion, right of the name and never allowed to squeeze it: a long
   * name wraps to two lines and "200 g" keeps its own width. The owner's "XL
   * flour tortilla" and a 36-character name both render in full here, which is
   * the difference between this view and the row that sent them to it.
   */
  itemPortion: { ...tnum, color: color.muted, fontSize: 12, flexShrink: 0 },
  itemMacros: { ...tnum, color: color.muted, fontSize: 13, marginTop: 2 },

  footnote: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: space.md },
  note: { color: color.muted, fontSize: 13, lineHeight: 19, marginTop: space.md },
  empty: { color: color.ink, fontSize: 14, lineHeight: 20, marginTop: space.md },

  actions: { gap: space.sm, marginTop: space.lg },
  bad: { color: color.bad, fontSize: 12, lineHeight: 17, marginTop: space.sm },
});

/**
 * What a logged meal actually was, item by item, and the two things that can be
 * done about it.
 *
 * ── WHY A SHEET AND NOT AN EXPANDING ROW ───────────────────────────────────
 *
 * A meal row sits in a scrolling day list, and the owner logs one-handed: an
 * expand-in-place would reflow every row below it, push an eleven-item block
 * off the bottom of the viewport, and put the disclosure control at whatever
 * height the row happened to be scrolled to — whereas this panel is anchored to
 * the bottom of the screen inside thumb reach, caps and scrolls itself, leaves
 * the list untouched behind it, and is already what the owner's tap opened. So
 * the gesture they had already tried becomes the one that answers them, and
 * `Repeat` and `Delete` stay exactly where they were.
 *
 * Every item carries its own macros, not just its name. "+2 more" being
 * unopenable was the complaint; a list of six names with one total underneath
 * would have answered the letter of it and left the owner no way to find WHICH
 * item the estimate got wrong. The per-item figures are what make a wrong
 * number fixable rather than merely visible — they say the 1683 is 580 of
 * ground turkey, not 580 of yoghurt.
 *
 * It draws and decides nothing: `mealDetail` in `model.ts` owns every string,
 * fallback and the one-item fold, and is unit-tested there. Nothing in this file
 * is verifiable without a simulator, so nothing in this file is a decision.
 */
export function MealSheet({ meal, busy, error, onRepeat, onRemove, onClose }: {
  /** Null closes the sheet. The panel stays mounted while it slides out. */
  meal: MealDto | null;
  busy: boolean;
  error: string | null;
  onRepeat: (meal: MealDto) => void;
  onRemove: (meal: MealDto) => void;
  onClose: () => void;
}) {
  const detail = meal === null ? null : mealDetail(meal);

  return (
    <Sheet visible={meal !== null} onClose={onClose} title={detail?.title}>
      {meal !== null && detail !== null ? (
        <>
          <Text style={styles.total}>{detail.total}</Text>
          {detail.source !== null ? <Text style={styles.source}>{detail.source}</Text> : null}

          {detail.empty !== null ? (
            <Text style={styles.empty}>{detail.empty}</Text>
          ) : (
            <ScrollView
              style={styles.list}
              // The items are the point of the panel; the sheet must not steal
              // a drag that was aimed at scrolling them.
              keyboardShouldPersistTaps="handled"
            >
              {detail.items.map((row) => <ItemRow key={row.key} row={row} />)}

              {detail.footnote !== null ? (
                <Text style={styles.footnote}>{detail.footnote}</Text>
              ) : null}

              {/*
                The sentence the meal was logged from, kept at the foot of the
                list rather than the top. It is provenance: it explains where
                the items came from, and it is the only place a detail the
                analysis dropped ("no oil") is still legible.
              */}
              {detail.note !== null ? (
                <>
                  <Label style={{ marginTop: space.lg, marginBottom: space.xs }}>Logged from</Label>
                  <Text style={styles.note}>{detail.note}</Text>
                </>
              ) : null}
            </ScrollView>
          )}

          <View style={styles.actions}>
            <Button
              size="lg"
              onPress={() => onRepeat(meal)}
              disabled={busy || meal.items.length === 0}
            >
              Repeat on today
            </Button>
            <Button
              size="lg"
              variant="danger"
              onPress={() => onRemove(meal)}
              disabled={busy}
            >
              Delete
            </Button>
            <Button variant="ghost" onPress={onClose} disabled={busy}>Close</Button>
          </View>

          {error !== null ? <Text style={styles.bad}>{error}</Text> : null}
        </>
      ) : null}
    </Sheet>
  );
}

/**
 * Name and portion on one baseline, macros under them.
 *
 * Not a `Pressable`: there is no edit path for a saved meal — `POST /api/meals`
 * writes and `DELETE` removes, and there is no PATCH — so a row that looked
 * tappable would cost the owner a tap to discover it is not. The way to fix a
 * wrong estimate today is delete and re-log, which is what the two buttons
 * below the list are for.
 */
function ItemRow({ row }: { row: MealItemRow }) {
  return (
    <View style={styles.item}>
      <View style={styles.itemHead}>
        <Text style={styles.itemName}>{row.name}</Text>
        {row.portion !== null ? <Text style={styles.itemPortion}>{row.portion}</Text> : null}
      </View>
      {row.macros !== null ? <Text style={styles.itemMacros}>{row.macros}</Text> : null}
    </View>
  );
}

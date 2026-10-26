import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card, Label, color, space, tnum } from "@/components/ui";
import type { MealDto } from "@/lib/types";

import { formatMacroLine, mealNamesLine, mealSlotLine, mealSummaryLine, mealTotals } from "./model";

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  head: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.md },
  body: { flexShrink: 1 },
  summary: { color: color.ink, fontSize: 14, lineHeight: 19 },
  macros: { ...tnum, color: color.muted, fontSize: 12, marginTop: space.xs },
  /**
   * The disclosure mark. The same accent arrow the "Session in progress" card
   * on Today uses for the same claim — this row opens something — rather than a
   * second glyph for the same idea.
   */
  arrow: { color: color.accent, fontSize: 16, marginTop: 2 },
});

/**
 * One logged meal in the day list.
 *
 * Both `onPress` and `onLongPress` open the same sheet, which looks redundant
 * and is not. The brief's gesture is the long-press, and a long-press with no
 * visible affordance is a gesture nobody discovers — so the tap is there to
 * make the actions findable at all, and the long-press is there because it is
 * the gesture a phone user's thumb reaches for. Neither one deletes anything
 * directly: destructive actions go through a `Sheet`, never through a press
 * that could have been a mis-scroll.
 *
 * ── THE ARROW ──────────────────────────────────────────────────────────────
 *
 * The owner's words were "I'm never able to see what I actually ate, even if I
 * try to click into it" — and the tap did work, it opened a sheet that listed
 * two buttons and no food. Half of that was the sheet, which now carries the
 * breakdown (`MealSheet`). The other half is that nothing about this row ever
 * said it opened anything: the row was pressable and looked inert, so "+2 more"
 * read as a dead end rather than as a door. Hence one 16pt accent arrow, the
 * cheapest possible statement that there is more behind this.
 *
 * The label carries the item count and the summary counts its own overflow
 * rather than being clipped. A meal is whatever was saved in one request — one
 * save, one row, no grouping anywhere — so a sentence describing a whole day
 * legitimately produces one row with a day in it, and the row has to be able to
 * say so. See `mealNamesLine`, which is bounded by a character budget as well
 * as an item count: four names of thirty characters would clip at two lines
 * with no tail, which is the same illegible row the count was meant to fix.
 */
export function MealRow({ meal, onOpen }: {
  meal: MealDto;
  onOpen: (meal: MealDto) => void;
}) {
  return (
    <Pressable
      onPress={() => onOpen(meal)}
      onLongPress={() => onOpen(meal)}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
      accessibilityRole="button"
      // The full list, not the bounded one: a screen reader has no two-line
      // budget to run out of, and "+7 more" is useless read aloud.
      accessibilityLabel={`${mealSlotLine(meal)}: ${mealSummaryLine(meal)}. ${formatMacroLine(mealTotals(meal))}`}
      accessibilityHint="Opens every item with its own calories, to repeat or delete"
    >
      <Card>
        <View style={styles.head}>
          <View style={styles.body}>
            <Label>{mealSlotLine(meal)}</Label>
            <Text style={styles.summary} numberOfLines={2}>{mealNamesLine(meal)}</Text>
            <Text style={styles.macros}>{formatMacroLine(mealTotals(meal))}</Text>
          </View>
          {/* Decorative: the whole row is the button and already labelled. */}
          <Text style={styles.arrow} accessibilityElementsHidden importantForAccessibility="no">→</Text>
        </View>
      </Card>
    </Pressable>
  );
}

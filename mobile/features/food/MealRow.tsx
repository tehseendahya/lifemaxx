import { Pressable, StyleSheet, Text } from "react-native";

import { Card, Label, color, space, tnum } from "@/components/ui";
import type { MealDto } from "@/lib/types";

import { formatMacroLine, mealNamesLine, mealSlotLine, mealSummaryLine, mealTotals } from "./model";

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  summary: { color: color.ink, fontSize: 14, lineHeight: 19 },
  macros: { ...tnum, color: color.muted, fontSize: 12, marginTop: space.xs },
});

/**
 * One logged meal in the day list.
 *
 * Both `onPress` and `onLongPress` open the same action sheet, which looks
 * redundant and is not. The brief's gesture is the long-press, and a long-press
 * with no visible affordance is a gesture nobody discovers — so the tap is
 * there to make the actions findable at all, and the long-press is there
 * because it is the gesture a phone user's thumb reaches for. Neither one
 * deletes anything directly: destructive actions go through a `Sheet`, never
 * through a press that could have been a mis-scroll.
 *
 * The label carries the item count and the summary counts its own overflow
 * rather than being clipped. A meal is whatever was saved in one request — one
 * save, one row, no grouping anywhere — so a sentence describing a whole day
 * legitimately produces one row with a day in it, and the row has to be able to
 * say so. See `mealNamesLine`.
 */
export function MealRow({ meal, onOpenActions }: {
  meal: MealDto;
  onOpenActions: (meal: MealDto) => void;
}) {
  return (
    <Pressable
      onPress={() => onOpenActions(meal)}
      onLongPress={() => onOpenActions(meal)}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
      accessibilityRole="button"
      // The full list, not the bounded one: a screen reader has no two-line
      // budget to run out of, and "+7 more" is useless read aloud.
      accessibilityLabel={`${mealSlotLine(meal)}: ${mealSummaryLine(meal)}. ${formatMacroLine(mealTotals(meal))}`}
      accessibilityHint="Repeat on today, or delete"
    >
      <Card>
        <Label>{mealSlotLine(meal)}</Label>
        <Text style={styles.summary} numberOfLines={2}>{mealNamesLine(meal)}</Text>
        <Text style={styles.macros}>{formatMacroLine(mealTotals(meal))}</Text>
      </Card>
    </Pressable>
  );
}

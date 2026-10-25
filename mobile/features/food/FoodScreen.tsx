import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  Button, Card, Empty, Label, MacroBar, Screen, Sheet, Spinner,
  color, space, tnum,
} from "@/components/ui";
import { tapDone, tapError } from "@/lib/haptics";
import type { MealDto } from "@/lib/types";

import { DateStepper } from "./DateStepper";
import { MealCapture } from "./MealCapture";
import { MealRow } from "./MealRow";
import {
  analyzedFromMealItems, asMealSlot, formatIsoDateLabel, formatMacroLine,
  mealSummaryLine, relativeDayLabel,
} from "./model";
import { OFFLINE_SAVE, deleteMeal, describeFailure, saveMeal } from "./requests";
import { useFoodDay } from "./useFoodDay";

const styles = StyleSheet.create({
  figureRow: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  figure: { ...tnum, color: color.ink, fontSize: 30, fontWeight: "600" },
  figureTail: { ...tnum, color: color.muted, fontSize: 14, flexShrink: 1 },
  macros: { marginTop: space.md, gap: 10 },

  notice: { color: color.muted, fontSize: 12, lineHeight: 17, marginBottom: space.md },
  bad: { color: color.bad, fontSize: 12, lineHeight: 17, marginBottom: space.md },

  sheetSummary: { color: color.muted, fontSize: 13, lineHeight: 19, marginBottom: space.lg },
  sheetActions: { gap: space.sm },
  sheetBad: { color: color.bad, fontSize: 12, lineHeight: 17, marginTop: space.sm },

  centre: { paddingTop: space.xxl * 2, alignItems: "center" },
});

/**
 * Food — the day's meals, and the shortest path to adding one.
 *
 * The capture card is above the totals card rather than below it, which is the
 * order the web app uses and the right one here for a different reason: the
 * 72pt Photo button has to be reachable without a scroll on the smallest
 * phone, because the thing being optimised is the number of seconds between
 * deciding to log a meal and having logged it. Reading the day's totals is
 * what you do while the analysis runs.
 */
export default function FoodScreen() {
  const day = useFoodDay();

  /** The meal whose action sheet is open. */
  const [actionsFor, setActionsFor] = useState<MealDto | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /** One line under the capture card: "Added to today." after a repeat. */
  const [notice, setNotice] = useState<string | null>(null);

  function openActions(meal: MealDto) {
    setActionError(null);
    setNotice(null);
    setActionsFor(meal);
  }

  function closeActions() {
    if (actionBusy) return;
    setActionsFor(null);
    setActionError(null);
  }

  /**
   * Re-post an already-reviewed meal onto today. No model call, no review step
   * — the numbers were corrected by a human once and nothing about them has
   * changed, so this is two taps and one request.
   *
   * It always lands on today, never on the day being viewed: repeating is for
   * "I ate that again", which happens now. The meal keeps its original slot
   * rather than being re-slotted by the clock, because the slot is part of what
   * the user is pointing at in the list.
   */
  async function repeat(meal: MealDto) {
    setActionBusy(true);
    setActionError(null);
    try {
      await saveMeal({
        slot: asMealSlot(meal.slot),
        note: meal.note,
        source: "repeat",
        // Null rather than the original's score: a model confidence described
        // an estimate, and these numbers have since been reviewed and accepted
        // by a person. Carrying the old figure would understate them.
        confidence: null,
        items: analyzedFromMealItems(meal.items),
      });
      tapDone();
      day.invalidateToday();
      setActionsFor(null);
      // Only worth saying when the user is looking at a different day, where
      // the new meal will not appear in the list in front of them.
      setNotice(day.selected === null ? null : "Added to today.");
    } catch (err) {
      tapError();
      setActionError(describeFailure(err, OFFLINE_SAVE));
    } finally {
      setActionBusy(false);
    }
  }

  async function remove(meal: MealDto) {
    setActionBusy(true);
    setActionError(null);
    try {
      await deleteMeal(meal.id);
      tapDone();
      day.invalidateDay();
      setActionsFor(null);
    } catch (err) {
      tapError();
      setActionError(describeFailure(err, "No signal. The meal is still here; try again later."));
    } finally {
      setActionBusy(false);
    }
  }

  const stepperLabel =
    day.shown !== null && day.today !== null ? relativeDayLabel(day.shown, day.today) : "today";

  return (
    <Screen
      title="Food"
      subtitle={day.shown !== null ? formatIsoDateLabel(day.shown) : undefined}
      action={
        <DateStepper
          label={stepperLabel}
          canBack={day.canStepBack}
          canForward={day.canStepForward}
          onBack={() => { setNotice(null); day.stepBack(); }}
          onForward={() => { setNotice(null); day.stepForward(); }}
        />
      }
      refreshing={day.refreshing}
      onRefresh={day.onRefresh}
    >
      <MealCapture
        localDate={day.selected}
        dayLabel={day.shown !== null && day.today !== null ? relativeDayLabel(day.shown, day.today) : null}
        onSaved={() => { setNotice(null); day.invalidateDay(); }}
      />

      {notice !== null ? <Text style={styles.notice}>{notice}</Text> : null}

      {day.loading ? (
        <View style={styles.centre}><Spinner size="large" /></View>
      ) : day.error !== null ? (
        <>
          <Text style={styles.bad}>{day.error}</Text>
          <Button variant="secondary" onPress={day.retry}>Try again</Button>
        </>
      ) : day.data ? (
        <>
          <Card>
            <Label>{stepperLabel}</Label>
            <View style={styles.figureRow}>
              <Text style={styles.figure}>{Math.round(day.data.totals.kcal)}</Text>
              <Text style={styles.figureTail}>
                {day.data.target.kcal !== null
                  ? `of ${day.data.target.kcal} kcal`
                  : "kcal · no target yet, still calibrating"}
              </Text>
            </View>
            <View style={styles.macros}>
              {/* Protein is `good` because it is the floor to clear rather than
                  the ceiling to stay under — same treatment as the web app. */}
              <MacroBar label="Protein" value={day.data.totals.proteinG} target={day.data.target.proteinG} tone="good" />
              <MacroBar label="Carbs" value={day.data.totals.carbsG} target={day.data.target.carbsG} />
              <MacroBar label="Fat" value={day.data.totals.fatG} target={day.data.target.fatG} />
            </View>
          </Card>

          {day.data.meals.length === 0 ? (
            <Empty>
              {day.selected === null
                ? "Nothing logged today. A photo or one sentence — both work."
                : "Nothing logged that day."}
            </Empty>
          ) : (
            day.data.meals.map((meal) => (
              <MealRow key={meal.id} meal={meal} onOpenActions={openActions} />
            ))
          )}
        </>
      ) : null}

      {/*
        The only confirmation mechanism in the app. A destructive action behind
        an `Alert.alert` would be the system interrupting the user in the system
        typeface; this is the app continuing, with 56pt targets.
      */}
      <Sheet
        visible={actionsFor !== null}
        onClose={closeActions}
        title={actionsFor !== null ? asTitle(actionsFor) : undefined}
      >
        {actionsFor !== null ? (
          <>
            <Text style={styles.sheetSummary} numberOfLines={2}>
              {formatMacroLine({
                kcal: actionsFor.kcal,
                proteinG: actionsFor.proteinG,
                carbsG: actionsFor.carbsG,
                fatG: actionsFor.fatG,
              })}
            </Text>
            <View style={styles.sheetActions}>
              <Button
                size="lg"
                onPress={() => { void repeat(actionsFor); }}
                disabled={actionBusy || actionsFor.items.length === 0}
              >
                Repeat on today
              </Button>
              <Button
                size="lg"
                variant="danger"
                onPress={() => { void remove(actionsFor); }}
                disabled={actionBusy}
              >
                Delete
              </Button>
              <Button variant="ghost" onPress={closeActions} disabled={actionBusy}>Close</Button>
            </View>
            {actionError !== null ? <Text style={styles.sheetBad}>{actionError}</Text> : null}
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

/** Enough of the meal to be sure you are deleting the right one. */
function asTitle(meal: MealDto): string {
  const summary = mealSummaryLine(meal);
  return summary.length > 42 ? `${summary.slice(0, 41)}…` : summary;
}

import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  Button, Columns, Empty, Screen, Spinner,
  color, space,
} from "@/components/ui";
import { tapDone, tapError } from "@/lib/haptics";
import type { MealDto } from "@/lib/types";

import { DateStepper } from "./DateStepper";
import { FuelCard } from "./FuelCard";
import { MealCapture } from "./MealCapture";
import { MealRow } from "./MealRow";
import { MealSheet } from "./MealSheet";
import {
  analyzedFromMealItems, asMealSlot, formatIsoDateLabel, relativeDayLabel, updatePayload,
  type MealDraft,
} from "./model";
import {
  OFFLINE_EDIT, OFFLINE_SAVE,
  deleteMeal, describeFailure, saveMeal, updateMeal,
} from "./requests";
import { useFoodDay } from "./useFoodDay";

const styles = StyleSheet.create({
  notice: { color: color.muted, fontSize: 12, lineHeight: 17, marginBottom: space.md },
  bad: { color: color.bad, fontSize: 12, lineHeight: 17, marginBottom: space.md },

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

  /** The meal whose detail sheet is open. */
  const [openMeal, setOpenMeal] = useState<MealDto | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** One line under the capture card: "Added to today." after a repeat. */
  const [notice, setNotice] = useState<string | null>(null);

  function openDetail(meal: MealDto) {
    setActionError(null);
    setNotice(null);
    setOpenMeal(meal);
  }

  function closeDetail() {
    // Mid-delete the meal may be about to disappear from the list behind the
    // sheet; closing the panel out from under the spinner would leave the user
    // unsure whether it went through.
    if (actionBusy) return;
    setOpenMeal(null);
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
      setOpenMeal(null);
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

  /**
   * Save the item editor's draft: items replaced, totals recomputed by the
   * server. A direct call, not the outbox — on failure the sheet stays open
   * with the error and every edit intact.
   */
  async function saveEdit(meal: MealDto, draft: MealDraft) {
    setActionBusy(true);
    setSaving(true);
    setActionError(null);
    try {
      await updateMeal(updatePayload(meal.id, draft));
      tapDone();
      // The meal lives on the day being viewed, and today's fuel card reads
      // the same meals through `bootstrap`; `invalidateDay` refreshes both.
      day.invalidateDay();
      setOpenMeal(null);
    } catch (err) {
      tapError();
      setActionError(describeFailure(err, OFFLINE_EDIT));
    } finally {
      setSaving(false);
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
      setOpenMeal(null);
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
      {/*
        On a laptop the composer and the day sit side by side, so the meals you
        are logging against stay in view while you type. On the phone, the
        composer first, as before.
      */}
      <Columns
        left={
          <>
          <MealCapture
            localDate={day.selected}
            dayLabel={day.shown !== null && day.today !== null ? relativeDayLabel(day.shown, day.today) : null}
            onSaved={() => { setNotice(null); day.invalidateDay(); }}
      />

      {notice !== null ? <Text style={styles.notice}>{notice}</Text> : null}
      </>
        }
        right={
      <>

      {day.loading ? (
        <View style={styles.centre}><Spinner size="large" /></View>
      ) : day.error !== null ? (
        <>
          <Text style={styles.bad}>{day.error}</Text>
          <Button variant="secondary" onPress={day.retry}>Try again</Button>
        </>
      ) : day.data ? (
        <>
          {/*
            Protein used to be the only one of the four with a target, and the
            other three rendered an empty grey track — which reads as "you have
            eaten none of these" rather than "there is no target yet". That is
            calibration mode (§5.5 of SPEC.md) working exactly as specified and
            rendered exactly wrong. `FuelCard` draws what is known and says what
            is happening; `calibration.ts` decides which is which.
          */}
          <FuelCard
            label={stepperLabel}
            totals={day.data.totals}
            target={day.data.target}
            tdee={day.tdee}
          />

          {day.data.meals.length === 0 ? (
            <Empty>
              {day.selected === null
                ? "Nothing logged today. A photo or one sentence — both work."
                : "Nothing logged that day."}
            </Empty>
          ) : (
            day.data.meals.map((meal) => (
              <MealRow key={meal.id} meal={meal} onOpen={openDetail} />
            ))
          )}
        </>
      ) : null}
      </>
        }
      />

      {/*
        Tapping a meal opens its item editor: edit is the primary action (the
        owner's call), with Repeat and Delete beneath it. Confirmations happen
        inline in the sheet, never in an `Alert.alert`.
      */}
      <MealSheet
        meal={openMeal}
        busy={actionBusy}
        saving={saving}
        error={actionError}
        onSave={(meal, draft) => { void saveEdit(meal, draft); }}
        onRepeat={(meal) => { void repeat(meal); }}
        onRemove={(meal) => { void remove(meal); }}
        onClose={closeDetail}
      />
    </Screen>
  );
}

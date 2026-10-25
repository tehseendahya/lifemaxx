import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button, Card, Label, color, radius, space } from "@/components/ui";
import { tapDone, tapError, tapSelect } from "@/lib/haptics";

import { ReviewCard } from "./ReviewCard";
import { captureMealPhoto } from "./capture";
import {
  toDraft,
  type AnalyzedItem, type DraftItem, type MealSlot, type MealSource,
} from "./model";
import {
  OFFLINE_ANALYSIS, OFFLINE_SAVE,
  analyzeMeal, describeFailure, saveMeal,
} from "./requests";

/**
 * Photo or sentence → a reviewed, saved meal. The port of
 * `src/components/MealCapture.tsx`, same phases, same contracts.
 *
 * ── THE IMAGE ───────────────────────────────────────────────────────────────
 *
 * The data URL is a local `const` inside `onPhoto` and is never put in state,
 * never passed as a prop and never logged. It exists between the camera
 * returning and `analyzeMeal` resolving, and then it is unreachable. That is
 * not an optimisation — it is the reason there is nothing to clean up when the
 * user cancels, backgrounds the app or force-quits mid-review, and it means no
 * amount of later editing in this component can accidentally retain a photo.
 * `capture.ts` deletes the two temp files the OS wrote on the way.
 */

/**
 * `capturing` and `analysing` are distinct because only one of them should put
 * "Reading…" on the button: while the system camera is up it covers the screen,
 * and coming back from a cancelled shot has to land on an idle card, not on a
 * card that claims to be working.
 */
type Phase = "idle" | "capturing" | "analysing" | "review" | "saving";

const NOTE_PLACEHOLDER =
  'What was it? Portion size matters more than the photo — "about 2 cups of rice, thigh not breast"';

const styles = StyleSheet.create({
  note: {
    minHeight: 76,
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
  actions: { marginTop: space.md, gap: space.sm },
  hint: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: space.sm },
  bad: { color: color.bad, fontSize: 12, lineHeight: 17, marginTop: space.sm },
});

export function MealCapture({ localDate, dayLabel, onSaved }: {
  /** The day being viewed, or `null` for today — then the server picks the date. */
  localDate: string | null;
  /** "yesterday", "4d ago" — only shown when `localDate` is set. */
  dayLabel: string | null;
  onSaved: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<DraftItem[] | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [source, setSource] = useState<MealSource>("photo");
  const [error, setError] = useState<string | null>(null);

  /*
   * Bumped on every analysis and used as the review card's `key`, so a second
   * attempt gets a genuinely fresh card. Without it the card's `useState`
   * initialisers would keep the first analysis's items — React does not re-run
   * them when a prop changes.
   */
  const [captureId, setCaptureId] = useState(0);

  async function runAnalysis(input: { imageDataUrl?: string; note?: string }, from: MealSource) {
    setPhase("analysing");
    setError(null);
    try {
      const analysis = await analyzeMeal(input);
      setItems(toDraft(analysis.items));
      setConfidence(analysis.confidence);
      setSource(from);
      setCaptureId((id) => id + 1);
      setPhase("review");
    } catch (err) {
      tapError();
      setError(describeFailure(err, OFFLINE_ANALYSIS));
      setPhase("idle");
    }
  }

  async function onPhoto() {
    tapSelect();
    setError(null);
    setPhase("capturing");

    let outcome;
    try {
      outcome = await captureMealPhoto();
    } catch {
      tapError();
      setError("The camera could not be opened.");
      setPhase("idle");
      return;
    }

    if (outcome.status === "cancelled") {
      setPhase("idle");
      return;
    }
    if (outcome.status === "denied") {
      tapError();
      // Not a dead end: the text path does not need the camera, and saying so
      // is more use than telling the user a permission was refused.
      setError("Camera access is off. Turn it on in Settings, or describe the meal and use Text only.");
      setPhase("idle");
      return;
    }
    if (outcome.status === "failed") {
      tapError();
      setError(outcome.message);
      setPhase("idle");
      return;
    }

    // The note goes up with the photo whenever there is one. The model cannot
    // see portion mass or cooking oil, so a sentence beside the picture is
    // worth more than the picture.
    await runAnalysis(
      { imageDataUrl: outcome.imageDataUrl, note: note.trim() === "" ? undefined : note.trim() },
      "photo",
    );
  }

  async function onTextOnly() {
    tapSelect();
    await runAnalysis({ note: note.trim() }, "text");
  }

  async function onSave(edited: AnalyzedItem[], slot: MealSlot) {
    setPhase("saving");
    setError(null);
    try {
      await saveMeal({
        slot,
        note: note.trim(),
        source,
        confidence,
        // Omitted for today, so the route's own notion of the date wins. Set
        // only when the user has stepped the list back to an earlier day, which
        // is what makes back-filling work.
        localDate: localDate ?? undefined,
        items: edited,
      });
      tapDone();
      setItems(null);
      setNote("");
      setConfidence(null);
      setPhase("idle");
      onSaved();
    } catch (err) {
      tapError();
      setError(describeFailure(err, OFFLINE_SAVE));
      // Back to review, not to idle: the card stays mounted and keeps every
      // edit, so a retry does not cost the user their corrections.
      setPhase("review");
    }
  }

  function onCancel() {
    tapSelect();
    setItems(null);
    setConfidence(null);
    setError(null);
    setPhase("idle");
    /*
     * The note is deliberately kept. The commonest reason to cancel a review is
     * that the estimate was poor, and the fix the card itself recommends is a
     * sentence about portion size — so throwing away what the user already
     * typed would make the recovery path longer than the original one. The
     * image is already gone: it was never stored anywhere to begin with.
     */
  }

  if ((phase === "review" || phase === "saving") && items !== null) {
    return (
      <ReviewCard
        key={captureId}
        initialItems={items}
        confidence={confidence}
        note={note}
        saving={phase === "saving"}
        error={error}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  }

  const busy = phase === "capturing" || phase === "analysing";

  return (
    <Card>
      <Label>Log a meal</Label>

      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder={NOTE_PLACEHOLDER}
        placeholderTextColor={color.muted}
        style={styles.note}
        multiline
        // The system keyboard belongs here and in the coach's field, and
        // nowhere else in this app. A meal description is prose.
        editable={!busy}
        accessibilityLabel="What was the meal"
      />

      <View style={styles.actions}>
        {/* 72pt, because this is the one button in the flow and it gets pressed
            one-handed while holding a plate. */}
        <Button size="hero" onPress={() => { void onPhoto(); }} disabled={busy}>
          {phase === "analysing" ? "Reading…" : "Photo"}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          onPress={() => { void onTextOnly(); }}
          disabled={busy || note.trim() === ""}
        >
          {phase === "analysing" ? "Reading…" : "Text only"}
        </Button>
      </View>

      {localDate !== null && dayLabel !== null ? (
        <Text style={styles.hint}>Logging to {dayLabel}.</Text>
      ) : null}

      {error !== null ? <Text style={styles.bad}>{error}</Text> : null}
    </Card>
  );
}

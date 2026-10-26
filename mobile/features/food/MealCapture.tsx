import { useRef, useState, type ComponentRef } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button, Card, Label, color, hit, microLabel, radius, space } from "@/components/ui";
import { tapDone, tapError, tapSelect } from "@/lib/haptics";

import { ReviewCard } from "./ReviewCard";
import { captureMealPhoto, pickMealPhoto, type CaptureOutcome } from "./capture";
import {
  analyzeInput, canLog, logButtonLabel, placeholderFor, savePayload, sourceFor,
  type ComposePhoto,
} from "./compose";
import {
  defaultSlot, sameItems, toAnalyzed, toDraft,
  type DraftItem, type MealSlot, type MealSource,
} from "./model";
import {
  OFFLINE_ANALYSIS, OFFLINE_SAVE,
  analyzeMeal, describeFailure, saveMeal,
} from "./requests";

/**
 * Caption + photo → one analysis → a reviewed, saved meal.
 *
 * ── COMPOSE FIRST, PARSE ONCE ───────────────────────────────────────────────
 *
 * The owner: "after uploading a photo, it immediately goes into the log add
 * phase and you can't type more. I want it to be like a caption and a
 * picture". So attaching a photo only attaches it. The caption stays editable
 * (and is focused again when the camera closes), and LOG MEAL sends the photo
 * and the caption together in one `/api/meals/analyze` call — which is what
 * lets "plus a protein shake" become an item the photo could never show.
 *
 * ── THE PHOTO ───────────────────────────────────────────────────────────────
 *
 * `photo` is a data URL in React state and nowhere else: not React Query, not
 * AsyncStorage, not SecureStore, not the outbox, not a file (`capture.ts`
 * deletes the scratch files it came from). It is set to null on a successful
 * save, on Cancel and on ✕; when this component unmounts its state goes with
 * it, and there is no ref, cache or module variable holding a copy. It has to
 * live in state now — RE-ESTIMATE re-sends the same photo with an edited
 * caption — which is the reason the save body is built by `savePayload`, a
 * function that names every field and is tested to carry no image.
 */

/**
 * `picking` and `analysing` are distinct because only one of them should put
 * "Reading…" on the button: while the system camera or library is up it
 * covers the screen, and coming back from a cancelled pick has to land on an
 * idle composer, not on one that claims to be working.
 */
type Phase = "compose" | "picking" | "analysing" | "review" | "reestimating" | "saving";

const styles = StyleSheet.create({
  caption: {
    minHeight: 76,
    // About five lines at 19pt, then it scrolls: the composer must not push
    // LOG MEAL off a small screen however much is typed.
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
  attached: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.md },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: color.surface2 },
  chip: {
    minWidth: hit.min,
    minHeight: hit.min,
    paddingHorizontal: space.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  chipGlyph: { color: color.muted, fontSize: 20 },
  chipLabel: { ...microLabel, color: color.accent },
  sources: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  source: { flex: 1 },
  actions: { marginTop: space.md },
  hint: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: space.sm },
  bad: { color: color.bad, fontSize: 12, lineHeight: 17, marginTop: space.sm },
});

/**
 * In a browser there is no camera button: a laptop's webcam pointed at a plate
 * is not how anyone photographs a meal, and the photo is already on the phone
 * or in Downloads. One "Upload photo" button opens the file picker — the same
 * `pickMealPhoto` path the phone's Library button uses, so the same resize,
 * encode and discard, and nothing stored.
 */
const WEB = Platform.OS === "web";

export function MealCapture({ localDate, dayLabel, onSaved }: {
  /** The day being viewed, or `null` for today — then the server picks the date. */
  localDate: string | null;
  /** "yesterday", "4d ago" — only shown when `localDate` is set. */
  dayLabel: string | null;
  onSaved: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("compose");
  const [caption, setCaption] = useState("");
  const [photo, setPhoto] = useState<ComposePhoto | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The review step. `analysed` is what the model returned, kept so the card
  // can tell whether the user has corrected it (and warn before re-estimating).
  const [items, setItems] = useState<DraftItem[]>([]);
  const [analysed, setAnalysed] = useState<DraftItem[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [source, setSource] = useState<MealSource>("text");
  const [slot, setSlot] = useState<MealSlot>(() => defaultSlot());

  const captionRef = useRef<ComponentRef<typeof TextInput>>(null);

  async function attach(pick: () => Promise<CaptureOutcome>, deniedMessage: string) {
    tapSelect();
    setError(null);
    setPhase("picking");

    let outcome: CaptureOutcome;
    try {
      outcome = await pick();
    } catch {
      tapError();
      setError("The photo could not be opened.");
      setPhase("compose");
      return;
    }

    setPhase("compose");
    if (outcome.status === "cancelled") return;
    if (outcome.status === "denied") {
      tapError();
      setError(deniedMessage);
      return;
    }
    if (outcome.status === "failed") {
      tapError();
      setError(outcome.message);
      return;
    }

    // Attached, NOT analysed. The caption is handed straight back so the user
    // can say what the photo cannot show.
    setPhoto({ dataUrl: outcome.imageDataUrl });
    captionRef.current?.focus();
  }

  function dropPhoto() {
    tapSelect();
    setPhoto(null);
  }

  async function analyse(next: "review" | "reestimating") {
    const state = { caption, photo };
    if (!canLog(state)) return;
    tapSelect();
    setPhase(next === "review" ? "analysing" : "reestimating");
    setError(null);
    try {
      const analysis = await analyzeMeal(analyzeInput(state));
      const drafted = toDraft(analysis.items);
      setItems(drafted);
      setAnalysed(drafted);
      setConfidence(analysis.confidence);
      setSource(sourceFor(photo));
      setPhase("review");
    } catch (err) {
      tapError();
      setError(describeFailure(err, OFFLINE_ANALYSIS));
      // A failed first analysis returns to the composer with the caption and
      // the photo intact; a failed re-estimate stays on the review card with
      // the items the user already had.
      setPhase(next === "review" ? "compose" : "review");
    }
  }

  async function onSave() {
    setPhase("saving");
    setError(null);
    try {
      await saveMeal(savePayload({
        slot,
        caption,
        source,
        confidence,
        // Null for today, so the route's own notion of the date wins. Set only
        // when the user has stepped the list back to an earlier day.
        localDate,
        items: toAnalyzed(items),
      }));
      tapDone();
      setPhoto(null);
      setCaption("");
      setItems([]);
      setAnalysed([]);
      setConfidence(null);
      setSlot(defaultSlot());
      setPhase("compose");
      onSaved();
    } catch (err) {
      tapError();
      setError(describeFailure(err, OFFLINE_SAVE));
      // Back to review, not to compose: every edit survives for the retry.
      setPhase("review");
    }
  }

  function onCancel() {
    tapSelect();
    setPhoto(null);
    setItems([]);
    setAnalysed([]);
    setConfidence(null);
    setError(null);
    setPhase("compose");
    /*
     * The caption is deliberately kept. The commonest reason to cancel a review
     * is that the estimate was poor, and the fix is a better sentence — so
     * throwing away what the user typed would lengthen the recovery path. The
     * photo is dropped: cancelling is the user saying this attempt is over.
     */
  }

  if (phase === "review" || phase === "reestimating" || phase === "saving") {
    return (
      <ReviewCard
        photo={photo}
        caption={caption}
        onCaptionChange={setCaption}
        items={items}
        onItemsChange={setItems}
        edited={!sameItems(analysed, items)}
        confidence={confidence}
        slot={slot}
        onSlotChange={setSlot}
        saving={phase === "saving"}
        reestimating={phase === "reestimating"}
        error={error}
        onSave={() => { void onSave(); }}
        onReestimate={() => { void analyse("reestimating"); }}
        onCancel={onCancel}
      />
    );
  }

  const busy = phase === "picking" || phase === "analysing";

  return (
    <Card>
      <Label style={{ marginBottom: space.sm }}>Log a meal</Label>

      <TextInput
        ref={captionRef}
        value={caption}
        onChangeText={setCaption}
        placeholder={placeholderFor(photo !== null)}
        placeholderTextColor={color.muted}
        style={styles.caption}
        multiline
        // Editable while a photo is attached — that is the whole change. Only
        // the analysis itself locks it, because what is sent is what was typed.
        editable={phase !== "analysing"}
        accessibilityLabel="What did you eat"
      />

      {photo !== null ? (
        <View style={styles.attached}>
          {/* RN `Image` from memory, not `expo-image`, which caches to disk. */}
          <Image source={{ uri: photo.dataUrl }} style={styles.thumb} accessibilityLabel="Attached meal photo" />
          <Pressable
            onPress={dropPhoto}
            disabled={busy}
            style={styles.chip}
            accessibilityRole="button"
            accessibilityLabel="Remove the photo"
          >
            <Text style={styles.chipGlyph}>×</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              void (WEB ? attach(pickMealPhoto, LIBRARY_DENIED) : attach(captureMealPhoto, CAMERA_DENIED));
            }}
            disabled={busy}
            style={styles.chip}
            accessibilityRole="button"
            accessibilityLabel={WEB ? "Choose a different photo" : "Retake the photo"}
          >
            <Text style={styles.chipLabel}>{WEB ? "Replace" : "Retake"}</Text>
          </Pressable>
        </View>
      ) : WEB ? (
        <View style={styles.sources}>
          <Button
            variant="secondary"
            style={styles.source}
            onPress={() => { void attach(pickMealPhoto, LIBRARY_DENIED); }}
            disabled={busy}
          >
            Upload photo
          </Button>
        </View>
      ) : (
        <View style={styles.sources}>
          <Button
            variant="secondary"
            style={styles.source}
            onPress={() => { void attach(captureMealPhoto, CAMERA_DENIED); }}
            disabled={busy}
          >
            Camera
          </Button>
          <Button
            variant="secondary"
            style={styles.source}
            onPress={() => { void attach(pickMealPhoto, LIBRARY_DENIED); }}
            disabled={busy}
          >
            Library
          </Button>
        </View>
      )}

      <View style={styles.actions}>
        {/* The one primary button in the flow, pressed one-handed over a plate. */}
        <Button
          size="hero"
          onPress={() => { void analyse("review"); }}
          disabled={busy || !canLog({ caption, photo })}
        >
          {logButtonLabel(phase === "analysing")}
        </Button>
      </View>

      {localDate !== null && dayLabel !== null ? (
        <Text style={styles.hint}>Logging to {dayLabel}.</Text>
      ) : null}

      {error !== null ? <Text style={styles.bad}>{error}</Text> : null}
    </Card>
  );
}

// Not dead ends: the caption path needs neither, and saying so beats reporting
// a refused permission.
const CAMERA_DENIED = "Camera access is off. Turn it on in Settings, pick from the library, or just describe the meal.";
const LIBRARY_DENIED = "Photo access is off. Turn it on in Settings, use the camera, or just describe the meal.";

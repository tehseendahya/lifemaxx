import { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { Button, Label, Sheet, Spinner, color, space, tnum } from "@/components/ui";
import { microLabel } from "@/components/ui/Label";
import { tapError, tapSave, tapSelect } from "@/lib/haptics";
import { pickMealPhoto } from "@/features/food/capture";

import {
  draftBlocked, draftFromShot, draftStats, formatStart,
  savePayload, type RunDraft,
} from "./import";
import { analyzeRunScreenshot, describeFailure, saveRun } from "./requests";

const styles = StyleSheet.create({
  lead: { color: color.muted, fontSize: 13, lineHeight: 19, marginBottom: space.lg },

  stats: { flexDirection: "row", gap: space.sm, marginBottom: space.lg },
  stat: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 12,
    backgroundColor: color.surface2,
    paddingHorizontal: space.sm,
    paddingVertical: space.md,
  },
  statValue: { ...tnum, color: color.ink, fontSize: 19, fontWeight: "600", marginTop: 2 },

  when: { ...microLabel, ...tnum, marginBottom: space.xs },
  title: { color: color.ink, fontSize: 15, marginBottom: space.lg },

  warn: { color: color.warn, fontSize: 13, lineHeight: 19, marginBottom: space.lg },
  error: { color: color.bad, fontSize: 13, lineHeight: 19, marginBottom: space.md },
  note: { color: color.muted, fontSize: 12, lineHeight: 18, marginBottom: space.lg },

  busy: { alignItems: "center", paddingVertical: space.xl },
  busyText: { color: color.muted, fontSize: 13, marginTop: space.md },

  secondary: { marginTop: space.sm },
});

type Stage =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "confirming"; draft: RunDraft }
  | { kind: "saving"; draft: RunDraft };

/**
 * Importing a run by photographing the number.
 *
 * ── WHY THIS EXISTS BESIDE TWO WORKING SYNCS ───────────────────────────────
 *
 * Every automatic route into this app costs money. A Strava API application
 * has required an active Strava subscription since June 2026; the Apple Health
 * relay needs the paid tier of a third-party app; the account archive is free
 * but is a zip you unpack on a laptop. None of those is "I just finished a run
 * and want it in the app before I've left the car park".
 *
 * So this is the free path, and it is deliberately the dumbest possible one:
 * share the screenshot you already took, check three numbers, save.
 *
 * ── IT READS, YOU CONFIRM ──────────────────────────────────────────────────
 *
 * Nothing is written until the button is pressed, and that is not politeness.
 * A wrong distance here does not sit in one row looking wrong — it goes into
 * the weekly mileage, the pace regression, the interference warning and the
 * coach's context at once, and nothing downstream can tell it was wrong. The
 * sheet therefore shows what will be stored, in the units the rest of the app
 * uses, and says out loud when it had to assume the date or when the figures
 * disagree with the pace printed beside them.
 *
 * The picker is `pickMealPhoto`, reused wholesale rather than copied: it
 * already resizes, strips EXIF, encodes once and deletes every file it
 * touched, and it works on web as a file picker. A screenshot is a photo; it
 * needed no new capture path, only a less food-specific name — which it keeps
 * for now because renaming it is a change to a file this one does not own.
 */
export function ImportRunSheet({
  visible,
  onClose,
  onImported,
}: {
  visible: boolean;
  onClose: () => void;
  /** Fired after a successful save so the screen can refetch. */
  onImported: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [error, setError] = useState("");

  const reset = () => {
    setStage({ kind: "idle" });
    setError("");
  };

  const close = () => {
    reset();
    onClose();
  };

  async function pick() {
    tapSelect();
    setError("");

    const outcome = await pickMealPhoto();
    if (outcome.status === "cancelled") return;
    if (outcome.status !== "ok") {
      setError(outcome.status === "denied"
        ? "Photo access was denied."
        : outcome.message);
      tapError();
      return;
    }

    setStage({ kind: "reading" });
    try {
      const reading = await analyzeRunScreenshot(outcome.imageDataUrl);
      if (!reading.readable) {
        setError(reading.note);
        setStage({ kind: "idle" });
        tapError();
        return;
      }
      setStage({ kind: "confirming", draft: draftFromShot(reading) });
    } catch (err) {
      setError(describeFailure(err));
      setStage({ kind: "idle" });
      tapError();
    }
  }

  async function save(draft: RunDraft) {
    const blocked = draftBlocked(draft);
    if (blocked !== null) {
      setError(blocked);
      tapError();
      return;
    }

    setStage({ kind: "saving", draft });
    setError("");
    try {
      await saveRun(savePayload(draft));
      tapSave();
      onImported();
      close();
    } catch (err) {
      setError(describeFailure(err));
      setStage({ kind: "confirming", draft });
      tapError();
    }
  }

  return (
    <Sheet visible={visible} onClose={close} title="Add a run from a screenshot">
      {error !== "" && <Text style={styles.error}>{error}</Text>}

      {stage.kind === "idle" && (
        <>
          <Text style={styles.lead}>
            Open the run in Strava (or any running app), screenshot it, and pick it here. The
            numbers are read off the picture — nothing is saved until you confirm them.
          </Text>
          <Button size="lg" onPress={() => void pick()}>
            {Platform.OS === "web" ? "CHOOSE A SCREENSHOT" : "PICK A SCREENSHOT"}
          </Button>
          <Button variant="ghost" style={styles.secondary} onPress={close}>CANCEL</Button>
        </>
      )}

      {stage.kind === "reading" && (
        <View style={styles.busy}>
          <Spinner size="large" />
          <Text style={styles.busyText}>Reading the screenshot…</Text>
        </View>
      )}

      {(stage.kind === "confirming" || stage.kind === "saving") && (
        <Confirm
          draft={stage.draft}
          saving={stage.kind === "saving"}
          onSave={() => void save(stage.draft)}
          onRetake={() => { reset(); void pick(); }}
          onCancel={close}
        />
      )}
    </Sheet>
  );
}

function Confirm({
  draft,
  saving,
  onSave,
  onRetake,
  onCancel,
}: {
  draft: RunDraft;
  saving: boolean;
  onSave: () => void;
  onRetake: () => void;
  onCancel: () => void;
}) {
  const blocked = draftBlocked(draft);

  return (
    <>
      <Text style={styles.when}>
        {formatStart(draft.startedAt).toUpperCase()}
        {draft.startAssumed ? "  ·  DATE ASSUMED" : ""}
      </Text>
      {draft.title !== "" && <Text style={styles.title}>{draft.title}</Text>}

      <View style={styles.stats}>
        {draftStats(draft).map((stat) => (
          <View key={stat.label} style={styles.stat}>
            <Label>{stat.label}</Label>
            <Text style={styles.statValue}>{stat.value}</Text>
          </View>
        ))}
      </View>

      {/*
        The two things worth saying out loud, in the order they matter.

        A disagreement between the figures and the printed pace is how a
        misread unit shows itself — 61% out, and otherwise invisible. An
        assumed date is quieter but decides which WEEK the run counts for.
      */}
      {draft.warning !== null && <Text style={styles.warn}>{draft.warning}</Text>}
      {draft.startAssumed && (
        <Text style={styles.note}>
          No date was visible on the screenshot, so this is filed as now. Re-import a
          screenshot that shows the date if that is wrong.
        </Text>
      )}
      {draft.note !== "" && <Text style={styles.note}>{draft.note}</Text>}
      {blocked !== null && <Text style={styles.error}>{blocked}</Text>}

      <Button size="lg" onPress={onSave} disabled={saving || blocked !== null}>
        {saving ? "SAVING…" : "SAVE THIS RUN"}
      </Button>
      <Button variant="ghost" style={styles.secondary} onPress={onRetake} disabled={saving}>
        PICK A DIFFERENT SCREENSHOT
      </Button>
      <Button variant="ghost" style={styles.secondary} onPress={onCancel} disabled={saving}>
        CANCEL
      </Button>
    </>
  );
}
